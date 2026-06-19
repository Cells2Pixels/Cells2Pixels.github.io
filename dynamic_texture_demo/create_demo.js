// Dynamic Texture demo for the Cells2Pixels landing page.
//
// Unlike the other demos this one has TWO targets: a target appearance
// (texture) and a target motion. The model key is `${appearance}_${motion}`.
// The selector area is split vertically into two stacked shelves (appearance
// on top, motion below). The motion shelf is injected into #pattern-controls
// at init; the landing page restores the baseline #pattern-controls markup
// before every demo switch, so the injected shelf is torn down automatically.

export function createDemoDynamicTexture(glsl, divId, onCanvasRendered = null) {
    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);

    const canvas = $("#demo-canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    // PENCA: C=16 cell-state channels, LPPN/Siren width 32 (like the 2d_pbr_demo).
    const CHN = 16, C4 = CHN / 4, D4 = 32 / 4, S4 = 1;
    const H = 128, W = 128; // Size of the NCA grid
    let model;
    let nca_grid, siren_grid;

    // Models are loaded lazily, one small file per appearance×motion combo, and
    // cached for the rest of the session. availableModels comes from manifest.json
    // (so we know what exists without downloading anything); modelDataCache holds
    // the decoded weights for every combo viewed so far (re-selecting => no fetch).
    let availableModels = new Set();
    const modelDataCache = new Map();
    let selectionToken = 0; // guards against out-of-order async selections
    // Bumped per demo instance on the shared glsl. Lets an in-flight fetch from a
    // previous demo bail before it overwrites the (tag-keyed, now reused) GL buffers.
    glsl.__demoGen = (glsl.__demoGen || 0) + 1;
    const demoGen = glsl.__demoGen;

    const HIGHLIGHT = "rgb(245 140 44)";

    // All appearance/motion thumbnails available on disk. The model set is still
    // incomplete: combinations without a trained model keep the last valid
    // result (see selectModel) rather than failing.
    const APPEARANCES = [
        "bubbly_0101", "bubbles", "chequered_0050", "crowd", "slime",
        "smoke_haze", "smoke_plume_2", "interlaced_0172", "polka-doted_0121", 
        "swirly_0005", "water", "water_3","veined_0106", "swirly_0071",
        "brick", "broccoli", "bubbly_0117",
        "bumpy_0081", "bumpy_0169", "banded_0037", "calm_water_4",
        "chequered_0088", "chequered_0121", "chequered_0212", "cobwebbed_0059",
        "cobwebbed_0141", "cracked_0085", "cracked_0122", "crosshatched_0121",
        "dotted_0201", "fibrous_145", "fire", "flames", "grass", "grid_0002", "grid_0040",
        "grid_0049", "grid_0135", "honeycombed_0061", "honeycombed_0171", "ink",
        "interlaced_0081", "interlaced_0163", "interlaced_0191", "leaf",
        "lichen", "rug", "rust", "sand", "sea_2", "smoke_2",
        "smoke_plume_3", "spiralled_0040",
        "spiralled_0042", "spiralled_0112", "spiralled_0124", "striped_0005", "sunflowers",
        "veined_0141", 
        "wood", "woven_0121",
        // "smoke_plume_1", "chequered_0051",

    ];
    const MOTIONS = [
        "up", "right", "right_acc_down", "right_acc_right",
        "circular", "concentrate", "diverge", "hyperbolic",
        "2block_x", "2block_y", "3block", "4block",

    ];

    const APPEARANCE_DIR = "dynamic_texture_demo/target_images/textures_hr/"; // <name>.jpg
    const MOTION_DIR = "dynamic_texture_demo/target_images/motion/";          // <name>.png

    const params = {
        models_dir: './dynamic_texture_demo/json_models/',   // <name>.json per model
        manifest_path: './dynamic_texture_demo/manifest.json',
        appearance: 'fire',
        motion: 'up',
        runModel: true,
        relativeScale: 4,
        reset_upon_load: false,
        speed: 1,
    };

    // View transform, shared with the siren + brush shaders (spread as ...uniforms).
    // viewR is the view extent in grid units: 1.0 = whole grid (fully zoomed out),
    // smaller = zoomed in. The demo starts fully zoomed out, so zoom-out is
    // disabled until the user zooms in. brush_enabled = false switches left-drag
    // from erasing to panning (also triggered by holding Shift).
    const uniforms = {
        viewR: 1.0,
        viewC: [0.5, 0.5],
        brush_size: 1.0,
        brush_enabled: true,
    };

    // Keep the view window inside the grid: viewC +/- viewR/2 must stay in [0, 1].
    function clampViewC() {
        const halfR = uniforms.viewR * 0.5;
        uniforms.viewC[0] = Math.min(1.0 - halfR, Math.max(halfR, uniforms.viewC[0]));
        uniforms.viewC[1] = Math.min(1.0 - halfR, Math.max(halfR, uniforms.viewC[1]));
    }

    let currentAppearanceEl = null;
    let currentMotionEl = null;
    let prevPos = [0, 0];
    let frame_count = 0;

    function modelName() {
        return params.appearance + '-' + params.motion;
    }

    // Resolve a `${appearance}_${motion}` key back into its two parts, preferring
    // the longest matching motion suffix (e.g. "right_acc_right" over "right").
    function splitKey(key) {
        const motionsByLen = MOTIONS.slice().sort((a, b) => b.length - a.length);
        for (const m of motionsByLen) {
            const suf = '_' + m;
            if (key.endsWith(suf)) {
                const a = key.slice(0, key.length - suf.length);
                if (APPEARANCES.includes(a)) return [a, m];
            }
        }
        return null;
    }

    function reset_ui() {
        if ($('#reset_on_load').checked == params.reset_upon_load) {
            $('#reset_on_load').checked = !params.reset_upon_load;
        }

        $('#play').style.display = params.runModel ? "none" : "inline";
        $('#pause').style.display = params.runModel ? "inline" : "none";

        if (params.speed != $('#speed').value) {
            $('#speed').value = params.speed;
        }
        $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][params.speed + 3];

        if (params.relativeScale != $('#LPPN_scale').value) {
            $('#LPPN_scale').value = params.relativeScale;
        }
        $('#LPPN_scaleLabel').innerHTML = `x${params.relativeScale}`;

        // Reflect brush size + mode (radio 2, the 'drag' icon, = pan) in the UI.
        $$('#brush_size input').forEach((sel, i) => {
            sel.checked = uniforms.brush_size === [0.5, 1.0, 2.0][i];
        });
        $$('#brush_mode input').forEach((sel, i) => {
            sel.checked = uniforms.brush_enabled ? (i === 0) : (i === 2);
        });

        // Start fully zoomed out: zoom-out disabled, zoom-in enabled.
        $('#zoomIn').classList.toggle('disabled', uniforms.viewR <= 0.1);
        $('#zoomOut').classList.toggle('disabled', uniforms.viewR >= 0.99);

        // reset all event listeners to avoid duplication across demo switches.
        document.onkeydown = null;
        document.onkeyup = null;
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;
        canvas.ontouchstart = null;
        canvas.ontouchend = null;
        canvas.ontouchmove = null;
    }

    reset_ui();

    function getMousePos(e) {
        return [e.offsetX / canvas.clientWidth, e.offsetY / canvas.clientHeight];
    }

    function getTouchPos(touch) {
        const rect = canvas.getBoundingClientRect();
        return [(touch.clientX - rect.left) / canvas.clientWidth,
        (touch.clientY - rect.top) / canvas.clientHeight];
    }

    function click(pos, e, first_touch = false) {
        const [x, y] = pos;
        const [px, py] = prevPos;
        const c = Math.min(canvas.clientWidth, canvas.clientHeight);
        // Map mouse to the [-1, 1] domain of the (square) grid, accounting for the
        // aspect-fit display so the brush lands under the cursor.
        const adjustedX = (x * 2.0 - 1.0) * (canvas.clientWidth / c);
        const adjustedY = (y * 2.0 - 1.0) * (canvas.clientHeight / c);

        if (!uniforms.brush_enabled || (e && e.shiftKey)) {
            // Pan: shift the view center by the drag delta (scaled by zoom level).
            if (first_touch) {
                prevPos = pos;
                return;
            }
            const dx = (px - x) * (canvas.clientWidth / c);
            const dy = (py - y) * (canvas.clientHeight / c);
            uniforms.viewC[0] += dx * uniforms.viewR;
            uniforms.viewC[1] += dy * uniforms.viewR;
            clampViewC();
        } else {
            brush(adjustedX, adjustedY);
        }
        prevPos = pos;
    }

    function init_event_listeners() {
        document.onkeydown = e => {
            if (e.key === 'r') {
                reset();
            }
        };

        canvas.onmousedown = e => {
            e.preventDefault();
            if (e.buttons == 1) {
                const panning = !uniforms.brush_enabled || e.shiftKey;
                canvas.style.cursor = panning ? 'grabbing' : 'pointer';
                click(getMousePos(e), e, true);
            }
        };
        canvas.onmousemove = e => {
            e.preventDefault();
            if (e.buttons == 1) {
                click(getMousePos(e), e, false);
            }
        };
        canvas.onmouseup = e => {
            e.preventDefault();
            canvas.style.cursor = 'default';
        };
        canvas.ontouchstart = e => {
            e.preventDefault();
            click(getTouchPos(e.changedTouches[0]), e, true);
        };
        canvas.ontouchmove = e => {
            e.preventDefault();
            for (const t of e.touches) {
                click(getTouchPos(t), e, false);
            }
        };

        $('#play-pause').onclick = () => {
            params.runModel = !params.runModel;
            $('#play').style.display = params.runModel ? "none" : "inline";
            $('#pause').style.display = params.runModel ? "inline" : "none";
        };

        $('#reset').onclick = () => {
            reset();
        };

        $('#zoomIn').onclick = () => {
            uniforms.viewR = Math.max(0.1, uniforms.viewR * 0.8);
            $('#zoomIn').classList.toggle('disabled', uniforms.viewR <= 0.1);
            $('#zoomOut').classList.remove('disabled');
            clampViewC();
        };
        $('#zoomOut').onclick = () => {
            uniforms.viewR = Math.min(1.0, uniforms.viewR / 0.8);
            $('#zoomOut').classList.toggle('disabled', uniforms.viewR >= 0.99);
            $('#zoomIn').classList.remove('disabled');
            clampViewC();
        };

        $$('#brush_size input').forEach((sel, i) => {
            sel.onchange = () => {
                uniforms.brush_size = [0.5, 1.0, 2.0][i];
            };
        });

        // Brush mode: radio 2 (the 'drag' icon) disables the brush so left-drag
        // pans instead of erasing; the other radios re-enable the erase brush.
        $$('#brush_mode input').forEach((sel, i) => {
            sel.onchange = () => {
                uniforms.brush_enabled = (i !== 2);
            };
        });

        $('#speed').oninput = e => {
            params.speed = parseInt(e.target.value);
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][params.speed + 3];
        };

        $('#LPPN_scale').oninput = e => {
            params.relativeScale = parseInt(e.target.value);
            $('#LPPN_scaleLabel').innerHTML = `x${params.relativeScale}`;
            updateSiren();
        };

        $('#reset_on_load').onchange = e => {
            params.reset_upon_load = !e.target.checked;
        };
    }

    init_event_listeners();

    // --- Selector UI (stacked: appearance over motion) ----------------------

    function makeShelfItem(name, mediaPath, onPick) {
        const el = document.createElement('div');
        el.style.background = "url('" + mediaPath + "')";
        el.style.backgroundSize = "100% 100%";
        el.className = 'target-square';
        el.onclick = () => {
            if (!window.matchMedia('(min-width: 500px)').matches && navigator.userAgent.includes("Chrome")) {
                el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            }
            onPick(el);
        };
        return el;
    }

    function buildSelectors() {
        const patternControls = $('#pattern-controls');
        const targetShelf = $('#target-shelf');

        // Appearance shelf reuses the baseline #target-shelf; relabel its title.
        const appearanceTitle = $('#pattern_selector_title h0');
        if (appearanceTitle) appearanceTitle.textContent = "Target Appearance";

        // The baseline grid has 3 rows (title / shelf / texhint). Override it to
        // 5 rows so the injected motion title + shelf get their own slots. Each
        // row hugs its content (`auto`); the appearance shelf is capped with an
        // explicit max-height and scrolls, instead of growing to fit all ~60
        // textures (which pushed the motion shelf down and, because the grid
        // stretches, left gaps between its rows). The landing page restores the
        // baseline markup (and these inline styles vanish) on the next switch.
        patternControls.style.gridTemplateRows =
            'min-content auto min-content auto min-content';
        targetShelf.style.maxHeight = '260px';
        targetShelf.style.overflowY = 'auto';

        // Inject the motion title + shelf right after the appearance shelf
        // (only once; the landing page restores the baseline markup on switch).
        if (!$('#motion-shelf')) {
            const motionTitle = document.createElement('div');
            motionTitle.className = 'pattern-selector-title';
            motionTitle.id = 'motion_selector_title';
            motionTitle.innerHTML = '<h0>Target Motion</h0><div class="whitespace"></div>';

            const motionShelf = document.createElement('div');
            motionShelf.id = 'motion-shelf';
            motionShelf.className = 'pattern-selector';
            motionShelf.style.overflowY = 'auto';

            targetShelf.after(motionTitle, motionShelf);
        }

        // Rebuild #texhint to hold both preview boxes side by side + one caption.
        const texhint = $('#texhint');
        texhint.innerHTML = '';
        texhint.style.display = 'flex';
        texhint.style.flexWrap = 'wrap';
        texhint.style.justifyContent = 'center';
        texhint.style.alignItems = 'center';
        texhint.style.columnGap = '12px';
        const origtex = document.createElement('div');
        origtex.id = 'origtex';
        const origmot = document.createElement('div');
        origmot.id = 'origmot';
        const texhinttext = document.createElement('span');
        texhinttext.id = 'texhinttext';
        texhinttext.style.flexBasis = '100%';
        texhint.append(origtex, origmot, texhinttext);

        // Populate appearance shelf.
        const appShelf = $('#target-shelf');
        appShelf.innerHTML = '';
        for (const name of APPEARANCES) {
            const el = makeShelfItem(name, APPEARANCE_DIR + name + ".jpg", picked => {
                if (currentAppearanceEl) currentAppearanceEl.style.borderColor = "white";
                currentAppearanceEl = picked;
                picked.style.borderColor = HIGHLIGHT;
                params.appearance = name;
                selectModel(params.reset_upon_load);
            });
            if (name === params.appearance) {
                el.style.borderColor = HIGHLIGHT;
                currentAppearanceEl = el;
                appShelf.prepend(el);
            } else {
                appShelf.appendChild(el);
            }
        }

        // Populate motion shelf.
        const motShelf = $('#motion-shelf');
        motShelf.innerHTML = '';
        for (const name of MOTIONS) {
            const el = makeShelfItem(name, MOTION_DIR + name + ".png", picked => {
                if (currentMotionEl) currentMotionEl.style.borderColor = "white";
                currentMotionEl = picked;
                picked.style.borderColor = HIGHLIGHT;
                params.motion = name;
                selectModel(params.reset_upon_load);
            });
            if (name === params.motion) {
                el.style.borderColor = HIGHLIGHT;
                currentMotionEl = el;
                motShelf.prepend(el);
            } else {
                motShelf.appendChild(el);
            }
        }
    }

    function setPreviewBox(el, mediaPath) {
        el.style.background = "url('" + mediaPath + "')";
        el.style.backgroundSize = "100% 100%";
        el.style.width = "96px";
        el.style.height = "96px";
        el.style.margin = "8px 0 0 0";
        el.style.borderRadius = "4px";
    }

    function updatePreview() {
        const available = availableModels.has(modelName());
        setPreviewBox($('#origtex'), APPEARANCE_DIR + params.appearance + ".jpg");
        setPreviewBox($('#origmot'), MOTION_DIR + params.motion + ".png");

        const desc = document.createElement('p');
        desc.innerHTML = "Appearance: " + params.appearance + " &nbsp;|&nbsp; Motion: " + params.motion +
            (available ? "" : "<br><i>(no trained model yet — showing last result)</i>");
        $('#texhinttext').innerHTML = '';
        $('#texhinttext').appendChild(desc);
    }

    // --- Model loading (lazy, one file per model, cached for the session) ----

    function decodeTensors(src) {
        for (const k in src) {
            if (src[k].data64 !== undefined) {
                src[k].data = new Float32Array(
                    Uint8Array.from(atob(src[k].data64), c => c.charCodeAt(0)).buffer);
                delete src[k].data64;
            }
        }
        return src;
    }

    // Fetch + decode a model's weights, caching the decoded data so re-selecting
    // the same combo never hits the network again. Returns null if unavailable.
    async function fetchModelData(name) {
        if (modelDataCache.has(name)) return modelDataCache.get(name);
        try {
            const r = await fetch(params.models_dir + encodeURIComponent(name) + '.json');
            if (!r.ok) return null;
            const src = decodeTensors(await r.json());
            modelDataCache.set(name, src);
            return src;
        } catch (e) {
            console.warn(`DynamicTexture: failed to load model "${name}":`, e);
            return null;
        }
    }

    function build_model(src) {
        // init NCA (PENCA): w1 has 4*C perception inputs + 2 positional-encoding inputs.
        const [ch, ci] = src['nca.w1.weight'].shape, co = src['nca.w2.weight.T'].shape[1];
        console.assert(co == CHN);
        const nca = {
            w1: glsl({}, { size: [ci / 4, ch], format: 'rgba32f', data: src['nca.w1.weight'].data, tag: 'w1' }),
            b1: glsl({}, { size: [1, ch], format: 'r32f', data: src['nca.w1.bias'].data, tag: 'b1' }),
            w2t: glsl({}, { size: [co / 4, ch], format: 'rgba32f', data: src['nca.w2.weight.T'].data, tag: 'w2t' }),
        };

        // init Siren / LPPN (identical structure to the 2d_pbr_demo, width 32).
        const sirenLayerN = 4;
        const inc = [`const int C4 = ${C4}; const int D4 = 32/4;`];
        const siren = {};
        for (let i = 0; i < sirenLayerN; ++i) {
            const last = i == sirenLayerN - 1;
            const s = `lppn.net.${i}` + (last ? '' : '.linear');
            const weight = src[s + '.weight'];
            const bias = src[s + '.bias'];
            const [no, ni] = weight.shape;
            inc.push(`
                uniform vec4 W${i}[${no * ni / 4}];
                uniform float B${i}[${no}];
                void run_layer${i}(in vec4 src[D4], out vec4 dst[D4]) {
                    const int no=${no}, ni=${ni};
                    for (int i=0; i<no; ++i) {
                        float a = B${i}[i];
                        #pragma unroll
                        for (int j=0; j<ni/4; ++j) {
                            a += dot(src[j], W${i}[i*ni/4 + j]);
                        }
                        dst[i/4][i%4] = ${last} ? a : sin(a*10.0);
                    }
                }`);
            siren['W' + i] = weight.data;
            siren['B' + i] = bias.data;
        }
        siren['Inc'] = inc.join('\n');
        return { nca, siren };
    }

    // Select the model for the current (appearance, motion). The fetch is async;
    // a token guards against rapid clicks resolving out of order. If the combo
    // has no trained model, keep the last valid one and warn (per design choice).
    async function selectModel(do_reset) {
        const name = modelName();
        updatePreview(); // reflect the selection (names + thumbnails) immediately
        if (!availableModels.has(name)) {
            console.warn(`DynamicTexture: no model "${name}"; keeping last loaded model.`);
            return;
        }
        const token = ++selectionToken;
        const src = await fetchModelData(name);
        if (token !== selectionToken || demoGen !== glsl.__demoGen) return; // superseded
        if (!src) return; // fetch failed; keep last loaded model
        model = build_model(src);
        if (do_reset) reset();
    }

    async function init() {
        // Load only the manifest up front (tiny); model weights are fetched lazily.
        try {
            const r = await fetch(params.manifest_path);
            if (r.ok) availableModels = new Set(await r.json());
        } catch (e) {
            console.warn('DynamicTexture: failed to load manifest:', e);
        }

        // If the configured default combo is absent, fall back to the first
        // available model so something renders.
        if (!availableModels.has(modelName())) {
            const first = availableModels.values().next().value;
            if (first) {
                const split = splitKey(first);
                if (split) {
                    params.appearance = split[0];
                    params.motion = split[1];
                }
            }
        }

        buildSelectors();

        const src = await fetchModelData(modelName());
        if (src && demoGen === glsl.__demoGen) model = build_model(src);
        reset();
        updatePreview();
        frame();
    }

    init();

    // --- Simulation ---------------------------------------------------------

    function reset() {
        // PENCA seed is zeros (noise_level defaults to 0). The positional encoding
        // breaks the symmetry and drives pattern formation from the zero state.
        nca_grid = glsl({
            seed: 42, FP: `
            FOut = FOut1 = FOut2 = FOut3 = vec4(0);
        `
        }, { size: [H, W], layern: C4, format: 'rgba16f', story: 2, tag: 'grid' });
    }

    function brush(x, y) {
        if (!model) return;
        const { nca } = model;
        glsl({
            ...nca, ...uniforms, x_pos: x, y_pos: y, FP: `
            // Map the click (screen clip space, [-1,1]) into grid-UV space through
            // the current view transform, so the brush tracks zoom + pan. The
            // radius scales with viewR to stay constant on screen as you zoom.
            vec2 click_pos = vec2(x_pos, y_pos) * viewR * 0.5 + viewC;
            float dist = length(UV.xy - click_pos);
            if (dist < 0.05 * brush_size * viewR) {
                FOut = FOut1 = FOut2 = FOut3 = vec4(0.0);
            } else {
                discard;
            }
        `
        }, nca_grid[0]);
    }

    function step() {
        if (!model) return;
        const { nca } = model;
        glsl({
            ...nca, seed: Math.random() * 26321, FP: `
            const int C4 = ${C4};
            const mat3 Kx = mat3(-1,-2,-1, 0,0,0, 1,2,1);
            const mat3 Ky = mat3(-1,0,1, -2,0,2, -1,0,1);
            const mat3 Klap = mat3(1,2,1, 2,-12,2, 1,2,1);

            // perc holds 4*C4 perception vec4s + 1 vec4 for the (x,y) positional encoding.
            vec4 perc[C4*4+1], upd[C4];

            void neib(int x, int y) {
                // Replicate padding: clamp neighbor coordinates to the grid bounds.
                ivec2 p = clamp(ivec2(I.x+x-1, I.y+y-1), ivec2(0), ViewSize-1);
                for (int i=0; i<C4; ++i) {
                    vec4 v = Src(p,i);
                    perc[C4+i]   += Kx[x][y]*v;
                    perc[C4*2+i] += Ky[x][y]*v;
                    perc[C4*3+i] += Klap[x][y]*v;
                }
            }

            void fragment() {
                for (int i=0; i<C4; ++i) {
                    upd[i] = perc[i] = Src(I,i);
                    perc[i+C4*3] = Klap[1][1]*upd[i];
                }
                // Positional encoding appended after the perception (2 channels), in
                // [-1, 1] over the grid. perc[C4*4].x <- xs (rows), .y <- ys (cols).
                perc[C4*4] = vec4(
                    2.0 * ((float(I.y) + 0.5) / float(ViewSize.y) - 0.5),
                    2.0 * ((float(I.x) + 0.5) / float(ViewSize.x) - 0.5),
                    0.0, 0.0);

                FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
                // Stochastic update mask (update_prob = 0.5).
                if (hash(ivec3(I,seed)).x>0.5) return;
                neib(0,0); neib(0,1); neib(0,2);
                neib(1,0);            neib(1,2);
                neib(2,0); neib(2,1); neib(2,2);

                int ci = w1_size().x, ch = w1_size().y;
                for (int h=0; h<ch; ++h) {
                    float y = b1(ivec2(0, h)).x;
                    for (int i=0; i<ci; ++i) {y += dot(perc[i], w1(ivec2(i, h)));}
                    if (y<=0.0) continue;
                    for (int i=0; i<C4; ++i) {upd[i] += y*w2t(ivec2(i, h));}
                }
                FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
            }
        `
        }, nca_grid);
    }

    function updateSiren() {
        if (!model) return;
        const { siren } = model;
        const scale = params.relativeScale;
        const [w, h] = nca_grid.size;
        siren_grid = glsl({
            nca_grid: nca_grid[0].linear, ...siren, ...uniforms, scale: scale, FP: `
            vec4 A[D4], B[D4];
            vec2 sz = vec2(nca_grid_size().xy);
            // Apply the view transform: at viewR=1, viewC=(0.5,0.5) this is just UV
            // (whole grid). Zooming in (smaller viewR) makes the LPPN decode
            // sub-cell detail for the smaller visible region.
            vec2 fetch_uv = (UV - 0.5) * viewR + viewC;
            vec2 patch_coord = (fract(fetch_uv*sz)-0.5)*2.0;
            // Fourier positional encoding (num_frequencies = 1): sin/cos of the
            // patch coordinate -> 4 inputs, then the 16 NCA channels (no padding).
            A[0].yx = sin(PI * patch_coord);
            A[0].wz = cos(PI * patch_coord);
            for (int i=0; i<C4; ++i) {
                A[i + 1] = nca_grid(fetch_uv, i);
            }
            run_layer0(A, B); run_layer1(B, A);
            run_layer2(A, B); run_layer3(B, A);
            FOut = A[0];
        `
        }, {
            size: [w * scale, h * scale],
            format: 'rgba16f', layern: S4, tag: 'siren'
        });
    }

    function frame(time) {
        glsl.adjustCanvas();
        // No model loaded yet (e.g. default still fetching, or empty manifest):
        // clear the canvas and keep the loop alive until one arrives.
        if (!model) {
            glsl({ Aspect: 'fit', Clear: 0.0, FP: `FOut = vec4(0.0, 0.0, 0.0, 1.0);` });
            glsl.animation_id = requestAnimationFrame(frame);
            return;
        }
        if (params.runModel) {
            let step_n;
            if (params.speed <= 0) {
                step_n = (frame_count % [1, 2, 4, 8][-params.speed]) == 0 ? 1 : 0;
                frame_count += 1;
            } else {
                step_n = [1, 2, 4, 8][params.speed];
            }
            for (let i = 0; i < step_n; ++i) {
                step();
            }
        }
        updateSiren();
        glsl({
            siren_grid: siren_grid.linear,
            Aspect: 'fit',
            Clear: 0.0,
            FP: `
            void fragment() {
                vec2 uv = vec2(UV.x, 1.0 - UV.y);
                vec3 rgb = siren_grid(uv, 0).rgb;
                FOut = vec4(rgb, 1.0);
            }
        `
        });

        if (typeof onCanvasRendered === 'function') {
            onCanvasRendered();
        }

        glsl.animation_id = requestAnimationFrame(frame);
    }
}
