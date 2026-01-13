
export function createDemoGrowing(glsl, divId) {
    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);

    const canvas = $("#demo-canvas");

    // const gui = new dat.GUI();

    const CHN = 32, C4 = CHN / 4, D4 = 64 / 4;
    const H = 128, W = 128; // Size of the NCA grid
    // const CHN = 16, C4 = CHN / 4, D4 = 32 / 4, S4 = 3;
    let models, model;
    let nca_grid, siren_grid;


    const params = {
        models_path: './2d_growing_demo/models.json',
        // models_path: './pbr_nca.json',
        model: 'Chameleon',
        // model: 'Sci-fi_Wall_010',
        runModel: true,
        relativeScale: 4,
        reset_upon_load: true,
        step_n: 1,
        speed: -1,
    };

    const uniforms = {
        viewR: 0.7,
        viewC: [0.5, 0.5],
        brush_size: 1.0,
        brush_mode: 0, // 0: erase, 1: seed
        brush_enabled: true,
    };

    let last_cursor_style = 'default';
    let prevPos = [0, 0];
    let longPressTimer;
    const longPressDuration = 500; // milliseconds
    let currentTarget = null;
    let frame_count = 0;


    
    function reset_ui() {
        if ($('#reset_on_load').checked == params.reset_upon_load) {
            $('#reset_on_load').checked = !params.reset_upon_load;
        }

        if (params.runModel) {
            $('#play').style.display = "none";
            $('#pause').style.display = "inline";
        } else {
            $('#play').style.display = "inline";
            $('#pause').style.display = "none";
        }

        if (params.speed != $('#speed').value) {
            $('#speed').value = params.speed;
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][params.speed + 3];
        }

        if (params.relativeScale != $('#LPPN_scale').value) {
            $('#LPPN_scale').value = params.relativeScale;
            $('#LPPN_scaleLabel').innerHTML = `x${params.relativeScale}`;
        }

        $$('#brush_size input').forEach((sel, i) => {
            if (uniforms.brush_size == 0.5 && i == 0) {
                sel.checked = true;
            } else if (uniforms.brush_size == 1.0 && i == 1) {
                sel.checked = true;
            } else if (uniforms.brush_size == 2.0 && i == 2) {
                sel.checked = true;
            }
        });

        $$('#brush_mode input').forEach((sel, i) => {
            if (!uniforms.brush_enabled && i == 2) {
                sel.checked = true;
            } else if (uniforms.brush_enabled && uniforms.brush_mode == i) {
                sel.checked = true;
            }
        });

        // reset all event listeners to avoid duplication
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


    function init_event_listeners() {
        // rewrite addEventListeners here using keydown
        document.onkeydown = e => {
            if (e.key === 'r') {
                reset();
            }
            if (e.key === "n") {
                for (let i = 0; i < 8; i++) {
                    step();
                    
                }
            }
            if (e.key === "Shift") {
                if (canvas.style.cursor != "grabbing") {
                    canvas.style.cursor = "grabbing";
                    last_cursor_style = canvas.style.cursor;
                }
            }
        };

        document.onkeyup = e => {
            if (e.key === "Shift") {
                canvas.style.cursor = "default";
                last_cursor_style = canvas.style.cursor;
            }
        }


        canvas.onmousedown = e => {
            e.preventDefault();
            // left click
            if (e.buttons == 1) {
                if (e.shiftKey) {
                    canvas.style.cursor = "grabbing";
                } else {
                    canvas.style.cursor = 'pointer';
                }
                click(getMousePos(e), e, true);
            }
        }
        canvas.onmousemove = e => {
            e.preventDefault();
            if (e.buttons == 1) {
                click(getMousePos(e), e, false);
            }
        }
        canvas.onmouseup = e => {
            e.preventDefault();
            canvas.style.cursor = last_cursor_style;
        }

        

        canvas.addEventListener("touchstart", e => {
            e.preventDefault();
            // click(getTouchPos(e.changedTouches[0]), e, true);
            longPressTimer = setTimeout(() => click(getTouchPos(e.changedTouches[0]), e, true, true), longPressDuration);
        });
        canvas.addEventListener("touchend", e => {
            e.preventDefault();
            clearTimeout(longPressTimer);
        });
        canvas.addEventListener("touchmove", e => {
            e.preventDefault();
            clearTimeout(longPressTimer);
            for (const t of e.touches) {
                click(getTouchPos(t), e, false);
            }
        });

        $('#play-pause').onclick = () => {
            params.runModel = !params.runModel;
            $('#play').style.display = !params.runModel ? "inline" : "none";
            $('#pause').style.display = params.runModel ? "inline" : "none";
            // updateUI();
        };

        $('#reset').onclick = () => {
            reset();
        }

        $('#zoomIn').onclick = () => {
            uniforms.viewR = Math.max(0.1, uniforms.viewR * 0.8);
            if (uniforms.viewR <= 0.1) {
                $('#zoomIn').classList.add('disabled');
            }
            $('#zoomOut').classList.remove('disabled');
            uniforms.viewC[0] = Math.min(1.0 - uniforms.viewR * 0.5, Math.max(uniforms.viewR * 0.5, uniforms.viewC[0]));
            uniforms.viewC[1] = Math.min(1.0 - uniforms.viewR * 0.5, Math.max(uniforms.viewR * 0.5, uniforms.viewC[1]));
        }

        $('#zoomOut').onclick = () => {
            uniforms.viewR = Math.min(1.0, uniforms.viewR / 0.8);
            if (uniforms.viewR >= 0.99) {
                $('#zoomOut').classList.add('disabled');
            }
            $('#zoomIn').classList.remove('disabled');
            uniforms.viewC[0] = Math.min(1.0 - uniforms.viewR * 0.5, Math.max(uniforms.viewR * 0.5, uniforms.viewC[0]));
            uniforms.viewC[1] = Math.min(1.0 - uniforms.viewR * 0.5, Math.max(uniforms.viewR * 0.5, uniforms.viewC[1]));
        }

        $$('#brush_size input').forEach((sel, i) => {
            sel.onchange = () => {
                if (i == 0) {
                    uniforms.brush_size = 0.5;
                } else {
                    if (i == 1) {
                        uniforms.brush_size = 1.0;
                    } else {
                        uniforms.brush_size = 2.0;
                    }
                }
            }

        });


        $$('#brush_mode input').forEach((sel, i) => {
            sel.onchange = () => {
                if (i == 2) {
                    uniforms.brush_enabled = false;
                } else {
                    uniforms.brush_enabled = true;
                    uniforms.brush_mode = i;
                }                
            }
        });


        $('#speed').oninput = e => {
            const speed = parseInt(e.target.value);
            params.speed = speed;
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][speed + 3];
            // $('#speedLabel').innerText = params.step_n + "x";
        };

        $('#LPPN_scale').oninput = e => {
            const scale = parseInt(e.target.value);
            params.relativeScale = scale;
            $('#LPPN_scaleLabel').innerHTML = `x${scale}`;
            updateSiren();

        }

        $('#reset_on_load').onchange = e => {
            params.reset_upon_load = !e.target.checked;
        }

        

    }

    function getMousePos(e) {
        const gridX = e.offsetX / canvas.clientWidth;
        const gridY = e.offsetY / canvas.clientHeight;
        return [gridX, gridY];
    }

    function getTouchPos(touch) {
        const rect = canvas.getBoundingClientRect();
        const gridX = (touch.clientX - rect.left) / canvas.clientWidth;
        const gridY = (touch.clientY - rect.top) / canvas.clientHeight;
        return [gridX, gridY];
    }

    function click(pos, e, first_touch = false, long_press = false) {
        const [x, y] = pos;
        const [px, py] = prevPos;
        
        const c = Math.min(canvas.clientWidth, canvas.clientHeight);
        const adjustedX = (x * 2.0 - 1.0) * (canvas.clientWidth / c);
        const adjustedY = (y * 2.0 - 1.0) * (canvas.clientHeight / c);

        if (!uniforms.brush_enabled || e.shiftKey) {
            
            if (first_touch) {
                prevPos = pos;
                return;
            }
            const dx = (px - x)  * (canvas.clientWidth / c);
            const dy = (py - y)  * (canvas.clientHeight / c);
            uniforms.viewC[0] += dx * uniforms.viewR;
            uniforms.viewC[1] += dy * uniforms.viewR;
            // Make sure the viewC + halfR and viewC - halfR are within [0, 1]
            const halfR = uniforms.viewR * 0.5;
            uniforms.viewC[0] = Math.min(1.0 - halfR, Math.max(halfR, uniforms.viewC[0]));
            uniforms.viewC[1] = Math.min(1.0 - halfR, Math.max(halfR, uniforms.viewC[1]));
            
            
        }
        else if (uniforms.brush_mode == 1 || long_press) {
            if (first_touch) brush(adjustedX, adjustedY, first_touch);
        } else {
            brush(adjustedX, adjustedY, false);
        }
        prevPos = pos;

        

    }


    init_event_listeners();


    async function init() {
        const response = await fetch(params.models_path);
        // const response = await fetch('./growing_nca.json');
        models = await response.json();

        let gridBox = $('#target-shelf');
        gridBox.innerHTML = '';
        $('#origtex').innerHTML = '';
        $('#origtex').style = '';
        $('#texhinttext').innerHTML = '';
        for (const name in models) {

            for (const k in models[name]) {
                const src = models[name][k];
                src.data = new Float32Array(
                    Uint8Array.from(atob(src.data64), c => c.charCodeAt(0)).buffer);
                delete src.data64;
            }

            let media_path = "./2d_growing_demo/target_images/" + name.toLowerCase() + ".png"

            const target_img = document.createElement('div');
            target_img.style.background = "url('" + media_path + "')";
            target_img.style.backgroundSize = "100% 100%";
            // target_img.style.backgroundSize = "100px100px";
            target_img.id = name; //html5 support arbitrary id:s
            target_img.className = 'target-square';
            target_img.onclick = () => {
                // removeOverlayIcon();
                currentTarget.style.borderColor = "white";
                currentTarget = target_img;
                target_img.style.borderColor = "rgb(245 140 44)";
                if (!window.matchMedia('(min-width: 500px)').matches && navigator.userAgent.includes("Chrome")) {
                    target_img.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
                }
                model = load_model(name);
                if (params.reset_upon_load) {
                    reset();
                }
                $("#origtex").style.background = "url('" + media_path + "')";
                $("#origtex").style.width = "224px";
                $("#origtex").style.height = "224px";
                $("#origtex").style.backgroundSize = "100% 100%";
                let desc = document.createElement('p')
                desc.innerHTML = "Target Image: " + name;
                // desc.href = "https://www.robots.ox.ac.uk/~vgg/data/dtd/"
                $("#texhinttext").innerHTML = '';
                $("#texhinttext").appendChild(desc);
            };


            if (name == params.model) {
                target_img.style.borderColor = "rgb(245 140 44)";
                gridBox.prepend(target_img);
                currentTarget = target_img;
                target_img.click();
            } else {
                gridBox.insertBefore(target_img, gridBox.lastElementChild);
            }
        }
        model = load_model(params.model);
        reset();
        frame();
    }

    init();

    function load_model(name) {
        if (params.reset_upon_load) {
            reset();
        }

        const src = models[name];
        // init NCA
        const [ch, ci] = src['nca.w1.weight'].shape, co = src['nca.w2.weight.T'].shape[1];
        // alert(`Model ${name} loaded: ${ch} channels, ${ci} inputs, ${co} outputs`);
        // ch256 ci128 co32
        console.assert(co == CHN)
        const nca = {
            w1: glsl({}, {
                size: [ci / 4, ch], format: 'rgba32f',
                data: src['nca.w1.weight'].data, tag: 'w1'
            }),
            b1: glsl({}, {
                size: [1, ch], format: 'r32f',
                data: src['nca.w1.bias'].data, tag: 'b1'
            }),
            w2t: glsl({}, {
                size: [co / 4, ch], format: 'rgba32f',
                data: src['nca.w2.weight.T'].data, tag: 'w2t'
            }),
        };

        // init Siren
        const sirenLayerN = 4;
        const inc = [`const int C4=${C4}; const int D4=${D4};`];
        inc.push(`
    `);
        const siren = {};
        for (let i = 0; i < sirenLayerN; ++i) {
            const last = (i === sirenLayerN - 1);
            const first = (i === 0);
            const s = `lppn.net.${i}` + (last ? '' : '.linear');
            const weight = src[s + '.weight'];
            const bias = src[s + '.bias'];
            const [no, ni] = weight.shape;
            // alert(`Siren layer ${i}: ${no} outputs, ${ni} inputs`);
            siren[`w${i}s`] = glsl({}, {
                size: [ni / 4, no], format: 'rgba32f',
                data: weight.data, tag: `w${i}s`
            });
            siren[`b${i}s`] = glsl({}, {
                size: [1, no], format: 'r32f',
                data: bias.data, tag: `b${i}s`
            });
            inc.push(`
        void run_layer${i}(in vec4 src[D4], out vec4 dst[D4]) {
            const int no=${no}, ni=${ni};
            for (int j=0; j<no; ++j) {
                // float a = B${i}[j];
                float a = b${i}s(ivec2(0, j)).x;
                # pragma unroll
                for (int k=0; k<ni/4; ++k) {
                    // a += dot(src[k], W${i}[j*ni/4 + k]);
                    a += dot(src[k], w${i}s(ivec2(k, j)));
                }
                // dst[j/4][j%4] = ${last} ? a : (${first} ? softplus(a*10.0) : sin(a*10.0));
                dst[j/4][j%4] = ${last} ? a : sin(a*10.0);
            }
        }`);
        }
        siren['Inc'] = inc.join('\n');
        return { nca, siren };
    }

    function reset() {
        nca_grid = glsl({
            seed: 42, FP: `
        FOut = vec4(0);
        if (I.x == ${H}/2 && I.y == ${W}/2) {
            FOut.w = 1.0;
            FOut1 = FOut2 = FOut3 = vec4(1.0);
            FOut4 = FOut5 = FOut6 = FOut7 = vec4(1.0);
        } else {
            FOut1 = FOut2 = FOut3 = vec4(0.0);
            FOut4 = FOut5 = FOut6 = FOut7 = vec4(0.0);
        }


    `
        }, { size: [H, W], layern: C4, format: 'rgba16f', story: 2, tag: 'grid' });
    }

    function brush(x, y, seed = false) {
        // alert("Brush function called at " + x + ", " + y + ", seed: " + seed);
        const { nca } = model;
        glsl({
            ...nca, x_pos: x, y_pos: y, seed: seed, ...uniforms, FP: `
        vec2 click_pos = vec2(x_pos, y_pos) * viewR * 0.5 + viewC;

        float dist = length(UV.xy - click_pos);
        if (seed) {
            // ivec2 I_click = ivec2((x_pos*0.5+0.5) * float(ViewSize.x), (y_pos*0.5+0.5) * float(ViewSize.y));
            ivec2 I_click = ivec2(click_pos.x * float(ViewSize.x), click_pos.y * float(ViewSize.y));
            if (I.x == I_click.x && I.y == I_click.y) {
                FOut = vec4(0.0, 0.0, 0.0, 1.0);
                FOut1 = FOut2 = FOut3 = FOut4 = FOut5 = FOut6 = FOut7 = vec4(1.0);
            } else {
                discard;
            }
        } else if (dist < 0.05 * brush_size * viewR) {
            FOut = FOut1 = FOut2 = FOut3 = vec4(0.0);
            FOut4 = FOut5 = FOut6 = FOut7 = vec4(0.0);
        } else {
            discard;
        }
    `
        }, nca_grid[0]);

    }

    function step() {
        const { nca } = model;
        glsl({
            ...nca, seed: Math.random() * 26321, FP: `
        const int C4 = ${C4};
        const float dx = 1.0;
        const float dt = min(1.0, 1.0 / (dx*dx));
        const mat3 Kx = mat3(-1,-2,-1, 0,0,0, 1,2,1)*dx;
        const mat3 Ky = mat3(-1,0,1, -2,0,2, -1,0,1)*dx;
        const mat3 Klap = mat3(1,2,1, 2,-12,2, 1,2,1)*dx*dx;

        vec4 perc[C4*4], upd[C4];
        
        void neib(int x, int y) {
            ivec2 p = (ivec2(I.x+x-1, I.y+y-1)+ViewSize)%ViewSize;
            for (int i=0; i<C4; ++i) {
                vec4 v = Src(p,i);
                perc[C4+i]   += Kx[x][y]*v; 
                perc[C4*2+i] += Ky[x][y]*v;
                perc[C4*3+i] += Klap[x][y]*v;
            }
        }

        float max_pool_alive() {
            float max_alive = 0.0;
            for (int x=-1; x < 2; ++x) {
                for (int y=-1; y < 2; ++y) {
                    ivec2 p = (ivec2(I.x+x, I.y+y)+ViewSize)%ViewSize;
                    max_alive = max(max_alive, Src(p, 0).w);
                }
            }
            return max_alive;
        }

        void set_all(vec4 x) {
            FOut = FOut1 = FOut2 = FOut3 = x;
            FOut4 = FOut5 = FOut6 = FOut7 = x;
        }

        void set_all_upd() {
            FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
            FOut4 = upd[4]; FOut5 = upd[5]; FOut6 = upd[6]; FOut7 = upd[7];
        }

        void fragment() {
            for (int i=0; i<C4; ++i) {
                upd[i] = perc[i] = Src(I,i);
                perc[i+C4*3] = Klap[1][1]*upd[i];
            }
            if (max_pool_alive() < 0.1) {
                set_all(vec4(0.0));
                return;
            }
            if (hash(ivec3(I,seed)).x<0.5) {
                neib(0,0); neib(0,1); neib(0,2);
                neib(1,0);            neib(1,2);
                neib(2,0); neib(2,1); neib(2,2);

                int ci = w1_size().x, ch = w1_size().y;
                for (int h=0; h<ch; ++h) {
                    float y = b1(ivec2(0, h)).x;
                    for (int i=0; i<ci; ++i) {y += dot(perc[i], w1(ivec2(i, h)));}
                    if (y<=0.0) continue;
                    for (int i=0; i<C4; ++i) {upd[i] += y*w2t(ivec2(i, h))*dt;}
                }
            }
            set_all_upd();
        }
    `
        }, nca_grid);
        // glsl({
        //     ...nca, seed: Math.random() * 26321, FP: `
        //     const int C4 = ${C4};
        //     float max_pool_alive() {
        //         float max_alive = 0.0;
        //         for (int x=-1; x < 2; ++x) {
        //             for (int y=-1; y < 2; ++y) {
        //                 ivec2 p = (ivec2(I.x+x, I.y+y)+ViewSize)%ViewSize;
        //                 max_alive = max(max_alive, Src(p, 0).w);
        //             }
        //         }
        //         return max_alive;
        //     }
        //
        //     void set_all(vec4 x) {
        //         FOut = FOut1 = FOut2 = FOut3 = x;
        //         FOut4 = FOut5 = FOut6 = FOut7 = x;
        //     }
        //
        //     void set_all_src() {
        //         FOut = Src(I, 0); FOut1 = Src(I, 1); FOut2 = Src(I, 2); FOut3 = Src(I, 3);
        //         FOut4 = Src(I, 4); FOut5 = Src(I, 5); FOut6 = Src(I, 6); FOut7 = Src(I, 7);
        //     }
        //
        //     void fragment() {
        //         if (max_pool_alive() < 0.1) {
        //             set_all(vec4(0.0));
        //             return;
        //         }
        //         set_all_src();
        //     }
        // `
        // }, nca_grid);
    }

    function updateSiren() {
        const { siren } = model;
        const scale = params.relativeScale;
        const [w, h] = nca_grid.size;
        siren_grid = glsl({
            nca_grid: nca_grid[0].linear, ...siren,
            scale: scale,
            ...uniforms,
            FP: `
        float max_pool_alive(vec2 xy, vec2 sz) {
            float max_alive = 0.0;
            for (int dx=-1; dx < 2; ++dx) {
                for (int dy=-1; dy < 2; ++dy) {
                    vec2 xyp = xy + vec2(dx, dy) / sz / scale;
                    max_alive = max(max_alive, nca_grid(xyp, 0).w);
                }
            }
            return max_alive;
        }

        void fragment() {
            vec4 A[D4], B[D4];
            vec2 sz = vec2(nca_grid_size().xy);
            // vec2 fetch_uv = UV+0.0/sz/scale;
            // vec2 fetch_uv = (UV - viewC) * viewR + viewC;
            vec2 fetch_uv = XY * viewR * 0.5 + viewC;
            float alive = max_pool_alive(fetch_uv, sz);
            // float alive = nca_grid(fetch_uv, 0).w;
            if (alive < 0.1) {
                FOut = vec4(0);
                return;
            }

            // vec2 patch_coord = (fract(UV*sz)-0.5)*2.0;
            vec2 patch_coord = (fract(fetch_uv*sz)-0.5)*2.0;
            
            
            A[0].yx = sin(PI * patch_coord);
            A[0].wz = cos(PI * patch_coord);
            for (int i=0; i<C4; ++i) {
                A[i + 1] = nca_grid(fetch_uv,i);
            }
            run_layer0(A, B);
            run_layer1(B, A);
            run_layer2(A, B);
            run_layer3(B, A);
            FOut = A[0];
        }
    `
        }, {
            size: [w * scale, h * scale],
            format: 'rgba16f', layern: 1, tag: 'siren'
        })
    }

    function frame(time) {
        glsl.adjustCanvas();
        time /= 1000.0;
        if (params.runModel) {
            let step_n;
            if (params.speed <= 0) {
                step_n = (frame_count % [1, 2, 4, 8][-params.speed]) == 0 ? 1 : 0;
                frame_count += 1;
            } else {
                step_n = [1, 2, 4, 8][params.speed];
            }
            for (let i = 0; i < step_n; i++) {
                step();
            }
        }
        updateSiren();
        glsl({
            state: nca_grid[0].linear,
            siren_grid: siren_grid.linear,
            ...uniforms,
            Aspect: 'fit',
            FP: `


        void fragment() {
            vec2 uv = vec2(UV.x, 1.0 - UV.y);
            vec4 rgba = siren_grid(uv, 0);
            vec3 rgb = rgba.xyz * 1.0;
            float alpha = rgba.w;
            // rgb = rgb * alpha + (1.0 - alpha) * 1.0;
            FOut = vec4(rgb, alpha) / 1.0;
        }


    `
        });


        glsl.animation_id = requestAnimationFrame(frame);
    }

}
