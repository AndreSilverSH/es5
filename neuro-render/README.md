# Нейро-рендер: IFC → проходы ControlNet → ComfyUI

Контролируемый рендер: **геометрия и ракурс берутся строго из модели**, а материалы,
свет и окружение — из ваших удачных рендеров. Нейросеть не «придумывает» здание:
её держат карты глубины и контуров, снятые с IFC-модели с точно заданной камеры.

```
IFC ──► веб-инструмент (index.html) ──► ZIP: depth / lineart / normal / seg / beauty + камеры
                                              │
         удачные рендеры (стиль) ─────────────┤
                                              ▼
                              comfy/comfy_render.py ──► ComfyUI (SDXL + ControlNet + IP-Adapter)
                                              │
                                              ▼
                                   renders/<ракурс>_s<seed>.png + .json (всё для повтора)
```

## 1. Запуск веб-инструмента

Нужен любой локальный HTTP-сервер: ES-модули и WASM с `file://` не работают.

```bash
cd es5            # корень репозитория
python -m http.server 8080
# открыть http://localhost:8080/neuro-render/
# или сразу с моделью: http://localhost:8080/neuro-render/?ifc=../models/3D_V5.ifc
```

Всё работает офлайн: three.js и web-ifc лежат в `vendor/`, CDN не нужен.

## 2. Как снять проходы

1. **Модель** — «Открыть IFC» или перетащить файл (`.ifc` и `.ifc.txt`). В списке
   классов можно скрыть лишнее; цветной квадрат — цвет класса в seg-карте.
2. **Кадр** — размер под модель (для SDXL ≈1 Мп: 1216×832, 1344×768, 1024×1024) и
   фокусное расстояние в мм (эквивалент 35 мм). «Горизонт» выравнивает взгляд, чтобы
   вертикали стен стали параллельны, как на архитектурной фотографии.
3. **Референс** — загрузите удачный рендер, выставьте прозрачность и совместите
   камеру с ним. «Кадр по референсу» подгоняет пропорции.
   Двойной клик по модели задаёт точку вращения.
4. **Ракурсы** — сохраните нужные виды (`fasad_yug`, `vid_s_ulicy`, …). Они хранятся в
   браузере; «Ракурсы → JSON» сохраняет их в файл для команды или репозитория.
5. **Просмотр** показывает все проходы; **ZIP** выгружает текущий кадр или все ракурсы.

| Проход  | Что это | Для чего |
|---------|---------|----------|
| `depth`   | Глубина: ближе — светлее, near/far подбираются по модели | ControlNet depth — объём и планы |
| `lineart` | Видимые рёбра без невидимых линий, белые на чёрном | ControlNet canny/lineart/MLSD — точные проёмы и линии |
| `normal`  | Нормали в системе камеры | ControlNet normal |
| `seg`     | Заливка по классам IFC цветами ADE20K (стена, окно, дверь, пол…) | ControlNet seg — где какой материал |
| `beauty`  | Обычный вид модели | Стартовое изображение для img2img, контроль |

## 3. ComfyUI

Потребуется:

* ComfyUI и чекпойнт SDXL (например `sd_xl_base_1.0` или ваш любимый фотореалистичный);
* ControlNet для SDXL: depth и canny/lineart (например xinsir `controlnet-depth-sdxl-1.0`,
  `controlnet-canny-sdxl-1.0` или один `controlnet-union-sdxl-1.0` — тогда в конфиге укажите
  `"union_type"`);
* для переноса стиля удачных рендеров — расширение **ComfyUI_IPAdapter_plus** и модели IP-Adapter.

```bash
cd neuro-render/comfy
cp config.example.json config.json      # имена моделей, промпт, seed
python comfy_render.py ~/Downloads/passes_all_*.zip
python comfy_render.py passes.zip --views fasad_yug --seeds 4     # 4 варианта одного вида
python comfy_render.py passes.zip --dry-run                       # только графы *.workflow.json
```

`*.workflow.json` из `--dry-run` можно перетащить в окно ComfyUI и доработать граф руками.

### Что за что отвечает в `config.json`

| Параметр | Смысл | С чего начать |
|---|---|---|
| `controlnets[].strength` | Насколько жёстко держать геометрию | depth 0.7–0.8, lineart 0.5–0.6 |
| `controlnets[].end` | До какой доли шагов действует контроль | 0.6–0.85 (меньше — живее фактуры) |
| `style_reference` | IP-Adapter по вашим удачным рендерам | `enabled: true`, weight 0.7–0.9, `style transfer` |
| `lora` | LoRA, обученная на ваших рендерах (самый стабильный «фирменный» стиль) | 0.6–0.9 |
| `init_image` | img2img от прохода `beauty` | denoise 0.75–0.85 |
| `seed` | Одинаковый seed + одинаковые проходы = одинаковый результат | фиксируйте удачные |
| `view_prompts` | Добавка к промпту для конкретного ракурса | `{"vid_s_ulicy": "street view, pedestrians"}` |

Рядом с каждой картинкой сохраняется `.json`: seed, промпт, камера и полный граф.
Удачный кадр можно повторить один в один или перерендерить после правки модели
с теми же ракурсами и seed.

### Как добиться «ваших» текстур и окружения

1. **IP-Adapter**: 1–3 удачных рендера в `style_reference.images`. Это самый быстрый путь.
2. **LoRA** на 15–40 ваших рендерах (kohya_ss / OneTrainer) — самый стабильный результат по
   серии кадров.
3. **Промпт** описывает материалы словами: «light travertine facade, anthracite window frames,
   birch trees, overcast sky».
4. Если ракурс точно совпадает с удачным рендером, возьмите этот рендер как `init_image`
   (положите его в ZIP вместо `beauty.png`) с denoise 0.4–0.6. Результат почти повторит
   референс, но с геометрией из обновлённой модели.

## 4. Встраивание в свою three.js-модель

Если у вас уже есть HTML-модель (с показателями, подписями, UI), не нужно переносить её
в `index.html`. Достаточно подключить панель:

```html
<script type="module">
  import { attachNeuroRender } from './neuro-render/js/embed.js';
  // renderer, scene, camera, controls — ваши объекты
  attachNeuroRender({ THREE, renderer, scene, camera, controls });
</script>
```

* Появится кнопка «Нейро-рендер» с жёлтой рамкой кадра, ракурсами и экспортом ZIP в том же
  формате, так что `comfy_render.py` работает без изменений.
* HTML-показатели поверх canvas в проходы не попадают. 3D-маркеры, подписи-спрайты и
  служебные объекты пометьте `obj.userData.noPass = true`.
* Класс для seg берётся из `userData.ifcType`, а если его нет — угадывается по имени
  меша или материала («стена», «окно», «wall», «glass», «кровля»…). Свой цвет задаётся через
  `userData.segColor = [r, g, b]`.

Рабочий пример: `examples/embed-example.html`.

Для более глубокой интеграции есть низкоуровневый модуль `js/passes.js`:

```js
import { createNeuroPasses } from './neuro-render/js/passes.js';
const np = createNeuroPasses(THREE, renderer, scene, camera);
const { depth, lineart, seg } = np.renderAll({ width: 1216, height: 832, passes: ['depth', 'lineart', 'seg'] });
```

## Файлы

```
neuro-render/
  index.html            веб-инструмент
  js/app.js             логика инструмента
  js/passes.js          рендер проходов (подключается к любой three.js-сцене)
  js/embed.js           панель для встраивания в готовую модель
  js/ifc-loader.js      IFC → three.js (web-ifc)
  js/segmap.js          классы IFC → палитра ADE20K
  js/zip.js             ZIP без зависимостей
  comfy/comfy_render.py отправка в ComfyUI (только стандартная библиотека Python)
  comfy/config.example.json
  demo/demo.ifc         демо-модель: 4 стены, 2 окна, дверь, плиты
  examples/embed-example.html
  vendor/               three.js r186, web-ifc 0.0.78 (MIT / MPL-2.0)
```
