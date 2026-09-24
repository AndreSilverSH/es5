#!/usr/bin/env python3
"""
Контролируемый нейро-рендер: служебные проходы из neuro-render → ComfyUI.

Берёт ZIP (или распакованную папку) из веб-инструмента, для каждого ракурса
загружает depth / lineart / … в ComfyUI, собирает граф
(SDXL + ControlNet [+ IP-Adapter по вашим удачным рендерам] [+ LoRA] [+ img2img]),
ставит его в очередь и скачивает результат.

Нужен только Python 3.8+ (стандартная библиотека).

Примеры:
    python comfy_render.py passes_all.zip
    python comfy_render.py passes_all.zip --config my.json --views fasad_yug --seeds 4
    python comfy_render.py passes_all.zip --dry-run        # только собрать графы в JSON
"""
import argparse
import json
import os
import random
import sys
import time
import uuid
import zipfile
from pathlib import Path
from urllib import error, parse, request

HERE = Path(__file__).resolve().parent


# ---------------------------------------------------------------- ввод ----

class PassSource:
    """Единый доступ к файлам проходов в ZIP или папке."""

    def __init__(self, path: Path):
        self.path = path
        self.zip = zipfile.ZipFile(path) if path.is_file() else None
        self.prefix = ""
        if self.zip:
            names = self.zip.namelist()
            job = [n for n in names if n.endswith("render_job.json")]
            if not job:
                sys.exit(f"В архиве {path} нет render_job.json")
            self.prefix = job[0][: -len("render_job.json")]
        elif not (path / "render_job.json").exists():
            sys.exit(f"В папке {path} нет render_job.json")

    def read(self, rel: str) -> bytes:
        if self.zip:
            return self.zip.read(self.prefix + rel)
        return (self.path / rel).read_bytes()

    def job(self) -> dict:
        return json.loads(self.read("render_job.json").decode("utf-8"))


# ------------------------------------------------------------- ComfyUI ----

class Comfy:
    def __init__(self, server: str):
        self.server = server.rstrip("/")
        self.client_id = str(uuid.uuid4())

    def _req(self, method, path, data=None, headers=None, timeout=60):
        req = request.Request(self.server + path, data=data, method=method, headers=headers or {})
        try:
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"ComfyUI {method} {path}: HTTP {e.code}\n{body}") from None
        except error.URLError as e:
            raise RuntimeError(f"Нет связи с ComfyUI ({self.server}): {e.reason}") from None

    def upload(self, name: str, data: bytes, subfolder="neuro-render") -> str:
        boundary = "----neuro" + uuid.uuid4().hex
        parts = []
        for key, val in (("overwrite", "true"), ("type", "input"), ("subfolder", subfolder)):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{val}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f"Content-Type: image/png\r\n\r\n".encode()
        )
        parts.append(data)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        body = b"".join(parts)
        res = json.loads(self._req("POST", "/upload/image", body,
                                   {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
        sub = res.get("subfolder") or ""
        return f"{sub}/{res['name']}" if sub else res["name"]

    def queue(self, workflow: dict) -> str:
        body = json.dumps({"prompt": workflow, "client_id": self.client_id}).encode()
        res = json.loads(self._req("POST", "/prompt", body, {"Content-Type": "application/json"}))
        if res.get("node_errors"):
            raise RuntimeError("Ошибки в графе: " + json.dumps(res["node_errors"], ensure_ascii=False, indent=2))
        return res["prompt_id"]

    def wait(self, prompt_id: str, timeout=1800, poll=1.5) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            hist = json.loads(self._req("GET", f"/history/{prompt_id}"))
            if prompt_id in hist:
                item = hist[prompt_id]
                status = item.get("status", {})
                if status.get("status_str") == "error":
                    raise RuntimeError("ComfyUI вернул ошибку: " + json.dumps(status, ensure_ascii=False)[:2000])
                return item
            time.sleep(poll)
        raise TimeoutError(f"Задача {prompt_id} не завершилась за {timeout} с")

    def image(self, filename, subfolder, folder_type) -> bytes:
        q = parse.urlencode({"filename": filename, "subfolder": subfolder, "type": folder_type})
        return self._req("GET", f"/view?{q}", timeout=120)


# ----------------------------------------------------------------- граф ----

def build_workflow(cfg: dict, images: dict, width: int, height: int, seed: int, prompt: str, prefix: str) -> dict:
    """images: {'depth': 'neuro-render/x.png', ..., 'style': [..]} — имена уже загруженных файлов."""
    wf = {}
    nid = [0]

    def add(class_type, inputs, title=None):
        nid[0] += 1
        key = str(nid[0])
        wf[key] = {"class_type": class_type, "inputs": inputs}
        if title:
            wf[key]["_meta"] = {"title": title}
        return key

    ckpt = add("CheckpointLoaderSimple", {"ckpt_name": cfg["checkpoint"]}, "Checkpoint")
    model = [ckpt, 0]
    clip = [ckpt, 1]
    vae = [ckpt, 2]

    lora = cfg.get("lora") or {}
    if lora.get("enabled"):
        l = add("LoraLoader", {
            "model": model, "clip": clip, "lora_name": lora["name"],
            "strength_model": lora.get("strength_model", 0.8),
            "strength_clip": lora.get("strength_clip", 0.8),
        }, "LoRA стиля")
        model, clip = [l, 0], [l, 1]

    style = cfg.get("style_reference") or {}
    if style.get("enabled") and images.get("style"):
        ipa_loader = add("IPAdapterUnifiedLoader", {"model": model, "preset": style.get("preset", "PLUS (high strength)")},
                         "IP-Adapter")
        ref = add("LoadImage", {"image": images["style"][0]}, "Референс стиля")
        ref_img = [ref, 0]
        for extra in images["style"][1:]:
            nxt = add("LoadImage", {"image": extra}, "Референс стиля")
            ref_img = [add("ImageBatch", {"image1": ref_img, "image2": [nxt, 0]}), 0]
        ipa = add("IPAdapterAdvanced", {
            "model": [ipa_loader, 0], "ipadapter": [ipa_loader, 1], "image": ref_img,
            "weight": style.get("weight", 0.8), "weight_type": style.get("weight_type", "style transfer"),
            "combine_embeds": "average", "start_at": style.get("start", 0.0), "end_at": style.get("end", 1.0),
            "embeds_scaling": "V only",
        }, "IP-Adapter: стиль удачных рендеров")
        model = [ipa, 0]

    pos = add("CLIPTextEncode", {"text": prompt, "clip": clip}, "Промпт")
    neg = add("CLIPTextEncode", {"text": cfg.get("negative", ""), "clip": clip}, "Негатив")
    positive, negative = [pos, 0], [neg, 0]

    for cn in cfg.get("controlnets", []):
        p = cn["pass"]
        if p not in images:
            print(f"  ! проход «{p}» отсутствует в архиве — ControlNet пропущен")
            continue
        img = add("LoadImage", {"image": images[p]}, f"Проход: {p}")
        loader = add("ControlNetLoader", {"control_net_name": cn["model"]}, f"ControlNet: {p}")
        inputs = {
            "positive": positive, "negative": negative, "control_net": [loader, 0], "image": [img, 0],
            "strength": cn.get("strength", 0.7), "start_percent": cn.get("start", 0.0), "end_percent": cn.get("end", 1.0),
        }
        if cn.get("union_type"):  # для ControlNet Union (xinsir promax и т. п.)
            typed = add("SetUnionControlNetType", {"control_net": [loader, 0], "type": cn["union_type"]})
            inputs["control_net"] = [typed, 0]
        apply = add("ControlNetApplyAdvanced", inputs, f"Применить ControlNet: {p}")
        positive, negative = [apply, 0], [apply, 1]

    init = cfg.get("init_image") or {}
    denoise = 1.0
    if init.get("enabled") and init.get("pass") in images:
        src = add("LoadImage", {"image": images[init["pass"]]}, f"Начальное изображение: {init['pass']}")
        latent = [add("VAEEncode", {"pixels": [src, 0], "vae": vae}), 0]
        denoise = float(init.get("denoise", 0.8))
    else:
        latent = [add("EmptyLatentImage", {"width": width, "height": height, "batch_size": 1}), 0]

    ks = add("KSampler", {
        "model": model, "positive": positive, "negative": negative, "latent_image": latent,
        "seed": seed, "steps": cfg.get("steps", 30), "cfg": cfg.get("cfg", 5.5),
        "sampler_name": cfg.get("sampler", "dpmpp_2m"), "scheduler": cfg.get("scheduler", "karras"),
        "denoise": denoise,
    }, "KSampler")
    dec = add("VAEDecode", {"samples": [ks, 0], "vae": vae})
    add("SaveImage", {"images": [dec, 0], "filename_prefix": prefix}, "Сохранить")
    return wf


# ---------------------------------------------------------------- main ----

def load_config(path):
    if path:
        p = Path(path)
    else:
        p = HERE / "config.json"
        if not p.exists():
            p = HERE / "config.example.json"
    cfg = json.loads(p.read_text(encoding="utf-8"))
    cfg["_dir"] = str(p.resolve().parent)
    print(f"Конфиг: {p}")
    return cfg


def main():
    ap = argparse.ArgumentParser(description="Проходы neuro-render → ComfyUI (контролируемый нейро-рендер)")
    ap.add_argument("passes", help="ZIP из веб-инструмента или папка с render_job.json")
    ap.add_argument("--config", help="JSON с настройками (по умолчанию comfy/config.json или config.example.json)")
    ap.add_argument("--views", help="Список ракурсов через запятую (по умолчанию все)")
    ap.add_argument("--seed", type=int, help="Базовый seed (перекрывает конфиг)")
    ap.add_argument("--seeds", type=int, help="Сколько вариантов (seed, seed+1, …) на ракурс")
    ap.add_argument("--prompt", help="Промпт (перекрывает конфиг)")
    ap.add_argument("--server", help="Адрес ComfyUI (перекрывает конфиг)")
    ap.add_argument("--out", help="Папка результатов (перекрывает конфиг)")
    ap.add_argument("--dry-run", action="store_true", help="Не отправлять в ComfyUI, только сохранить графы *.workflow.json")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.server:
        cfg["server"] = args.server
    src = PassSource(Path(args.passes))
    job = src.job()
    views = job["views"]
    if args.views:
        wanted = [v.strip() for v in args.views.split(",") if v.strip()]
        views = [v for v in views if v["name"] in wanted]
        if not views:
            sys.exit(f"Ракурсы {wanted} не найдены. Есть: {[v['name'] for v in job['views']]}")

    base_seed = args.seed if args.seed is not None else cfg.get("seed", -1)
    if base_seed is None or base_seed < 0:
        base_seed = random.randint(0, 2**31 - 1)
    n_seeds = args.seeds or cfg.get("seeds_per_view", 1)
    out_dir = Path(args.out or cfg.get("output_dir", "renders"))
    out_dir.mkdir(parents=True, exist_ok=True)
    comfy = None if args.dry_run else Comfy(cfg["server"])
    stamp = time.strftime("%Y%m%d-%H%M%S")

    style_names = []
    style = cfg.get("style_reference") or {}
    if style.get("enabled") and not args.dry_run:
        for ref in style.get("images", []):
            rp = Path(ref)
            if not rp.is_absolute():
                rp = Path(cfg["_dir"]) / rp
            if not rp.exists():
                raise RuntimeError(f"Не найден референс стиля: {rp}")
            style_names.append(comfy.upload(f"style_{stamp}_{rp.name}", rp.read_bytes()))
            print(f"Референс стиля загружен: {rp.name}")
    elif style.get("enabled"):
        style_names = [f"neuro-render/{Path(r).name}" for r in style.get("images", [])]

    needed = {cn["pass"] for cn in cfg.get("controlnets", [])}
    init = cfg.get("init_image") or {}
    if init.get("enabled"):
        needed.add(init.get("pass", "beauty"))

    total = 0
    for v in views:
        name = v["name"]
        w, h = int(v["width"]), int(v["height"])
        print(f"\n=== {name}  {w}×{h}, {v.get('focal_mm', '?')} мм ===")
        images = {}
        for p in sorted(needed):
            rel = v.get("files", {}).get(p)
            if not rel:
                continue
            if args.dry_run:
                images[p] = f"neuro-render/{stamp}_{name}_{p}.png"
            else:
                images[p] = comfy.upload(f"{stamp}_{name}_{p}.png", src.read(rel))
                print(f"  загружен {p}")
        if style_names:
            images["style"] = style_names

        prompt = args.prompt or cfg["prompt"]
        extra = (cfg.get("view_prompts") or {}).get(name)
        if extra:
            prompt = f"{prompt}, {extra}"

        for k in range(n_seeds):
            seed = base_seed + k
            prefix = f"{cfg.get('filename_prefix', 'neuro')}/{name}_s{seed}"
            wf = build_workflow(cfg, images, w, h, seed, prompt, prefix)
            meta = {"view": name, "seed": seed, "prompt": prompt, "negative": cfg.get("negative", ""),
                    "camera": {k2: v.get(k2) for k2 in ("position", "target", "focal_mm", "fov_deg")},
                    "source": str(args.passes), "workflow": wf}
            base = out_dir / f"{name}_s{seed}"
            if args.dry_run:
                (base.parent / f"{base.name}.workflow.json").write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  граф сохранён: {base.name}.workflow.json")
                continue
            pid = comfy.queue(wf)
            print(f"  seed {seed}: в очереди ({pid})…", end="", flush=True)
            item = comfy.wait(pid)
            saved = 0
            for node_out in item.get("outputs", {}).values():
                for im in node_out.get("images", []):
                    if im.get("type") != "output":
                        continue
                    data = comfy.image(im["filename"], im.get("subfolder", ""), im["type"])
                    target = base.with_suffix(".png") if saved == 0 else base.parent / f"{base.name}_{saved}.png"
                    target.write_bytes(data)
                    saved += 1
            base.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            total += saved
            print(f" готово → {base.with_suffix('.png')}")

    if not args.dry_run:
        print(f"\nВсего изображений: {total}. Папка: {out_dir.resolve()}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, TimeoutError) as e:
        sys.exit(f"\nОшибка: {e}")
