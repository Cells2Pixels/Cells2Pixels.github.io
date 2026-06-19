
export function createDemoPBR(glsl, divId, onCanvasRendered = null) {
    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);

    const canvas = $("#demo-canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    // const gui = new dat.GUI();

    const CHN = 16, C4 = CHN / 4, D4 = 32 / 4, S4 = 3;
    const H = 128, W = 128; // Size of the NCA grid
    let model;
    let nca_grid, siren_grid;

    // Models are fetched lazily (one small file per model) and cached for the
    // session, instead of downloading the whole combined models.json up front.
    const modelDataCache = new Map();
    let manifestNames = [];     // ordered model list, loaded from manifest.json
    let selectionToken = 0; // guards against out-of-order async selections
    // Bumped per demo instance on the shared glsl. Lets an in-flight fetch from a
    // previous demo bail before it overwrites the (tag-keyed, now reused) GL buffers.
    glsl.__demoGen = (glsl.__demoGen || 0) + 1;
    const demoGen = glsl.__demoGen;


    const params = {
        models_dir: './2d_pbr_demo/json_models/',
        manifest_path: './2d_pbr_demo/manifest.json',
        // models_path: './pbr_nca.json',
        model: 'Abstract_008',
        runModel: true,
        relativeScale: 4,
        reset_upon_load: false,
        step_n: 1,
        speed: -1,
    };

    const uniforms = {
        viewR: 0.64,
        viewC: [0.5, 0.5],
        brush_size: 1.0,
        brush_mode: 0, // 0: erase, 1: seed
        brush_enabled: true,
        visMode: 0,
        heightScale: 0.15,
        showWireframe: false,
        zoom: 0.0,
        geom: 1,
    };

    const camera = {
        theta: 45.0,
        phi: 30.0,
        // theta: 89.9,
        // phi: 0.0,
        distance: 2.0,
        fov: 60.0,
        znear: 0.001,
        zfar: 100.0,
        aspect: 1.0,
        up: [0, 0, 1],
        look_at: [0, 0, 0],
    }
    const camera_uniforms = {
        camera_position: null,
        view: null,
        projection: null,
    }

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
            click(getTouchPos(e.changedTouches[0]), e, true);
        });
        canvas.addEventListener("touchmove", e => {
            e.preventDefault();
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
            uniforms.zoom += 0.5;
            $('#zoomOut').classList.remove("disabled");
            if (uniforms.zoom > 4.0) {
                uniforms.zoom = 4.0;
                $('#zoomIn').classList.add("disabled");
            }
            rotate_camera(0, 0);
        }

        $('#zoomOut').onclick = () => {
            uniforms.zoom -= 0.5;
            $('#zoomIn').classList.remove("disabled");
            if (uniforms.zoom < -1.0) {
                uniforms.zoom = -1.0;
                $('#zoomOut').classList.add("disabled");
            }
            rotate_camera(0, 0);
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

    function click(pos, e, first_touch = false) {
        const [x, y] = pos;
        const [px, py] = prevPos;

        if (e.shiftKey || !uniforms.brush_enabled) {

            let delta_phi = 0.0;
            let delta_theta = 0.0;

            if (!first_touch) {
                delta_phi = -(x - px) * 4.0;
                delta_theta = (y - py) * 4.0;
            }
            rotate_camera(delta_phi, delta_theta);
            prevPos = pos;
        } else {
            // Adjust with the aspect ratio
            const c = Math.min(canvas.clientWidth, canvas.clientHeight);
            const adjustedX = (x * 2.0 - 1.0) * (canvas.clientWidth / c);
            const adjustedY = -(y * 2.0 - 1.0) * (canvas.clientHeight / c);
            brush(adjustedX, adjustedY);
            prevPos = pos;
        }


    }

    function reset_camera() {
        const { theta, phi, distance, fov, znear, zfar, aspect } = camera;
        const zoom = uniforms.zoom;

        camera_uniforms.camera_position = [
            distance * Math.cos(theta * Math.PI / 180) * Math.cos(phi * Math.PI / 180) / Math.pow(2., zoom),
            distance * Math.cos(theta * Math.PI / 180) * Math.sin(phi * Math.PI / 180) / Math.pow(2., zoom),
            distance * Math.sin(theta * Math.PI / 180) / Math.pow(2., zoom)
        ];

        camera_uniforms.view = m4.inverse(m4.lookAt(camera_uniforms.camera_position, camera.look_at, camera.up));
        camera_uniforms.projection = m4.perspective(fov * Math.PI / 180, aspect, znear, zfar);
    }

    function rotate_camera(delta_phi, delta_theta) {
        let up = m4.normalize(camera.up);
        const { theta, phi, distance, fov, znear, zfar, aspect, look_at } = camera;
        const zoom = uniforms.zoom;
        let y_camera = m4.normalize(m4.subtractVectors(look_at, camera_uniforms.camera_position));

        let z_camera = m4.normalize(m4.subtractVectors(up, m4.scaleVector(up, m4.dot(y_camera, up))));

        let x_camera = m4.normalize(m4.cross(y_camera, z_camera));

        camera_uniforms.camera_position = m4.addVectors(camera_uniforms.camera_position, m4.scaleVector(x_camera, delta_phi));
        camera_uniforms.camera_position = m4.addVectors(camera_uniforms.camera_position, m4.scaleVector(z_camera, delta_theta));
        camera_uniforms.camera_position = m4.scaleVector(m4.normalize(camera_uniforms.camera_position), distance / Math.pow(2., zoom));

        camera_uniforms.view = m4.inverse(m4.lookAt(camera_uniforms.camera_position, look_at, up));
        camera_uniforms.projection = m4.perspective(fov * Math.PI / 180, aspect, znear, zfar);
    }


    init_event_listeners();


    async function init() {
        // Load the ordered model list from the manifest (curated in manifest.json).
        try {
            const r = await fetch(params.manifest_path);
            if (r.ok) manifestNames = await r.json();
        } catch (e) {
            console.warn('PBR: failed to load manifest:', e);
        }

        let gridBox = $('#target-shelf');
        gridBox.innerHTML = '';
        $('#origtex').innerHTML = '';
        $('#origtex').style = '';
        $('#texhinttext').innerHTML = '';
        for (const name of manifestNames) {

            let media_path = "./2d_pbr_demo/target_images/" + name + "/rendered_white.jpg"
            console.log(media_path);
            let autocorr = name.includes(' + AutoCorr');
            media_path = media_path.replace(' + AutoCorr', '');


            const target_img = document.createElement('div');
            target_img.style.background = "url('" + media_path + "')";
            target_img.style.backgroundSize = "100% 100%";
            // target_img.style.backgroundSize = "100px100px";
            target_img.id = name; //html5 support arbitrary id:s
            target_img.className = 'target-square';
            target_img.style.borderColor = autocorr ? "rgb(97, 201, 23)" : "white";
            target_img.onclick = async () => {
                // removeOverlayIcon();
                currentTarget.style.borderColor = currentTarget.id.includes(' + AutoCorr') ? "rgb(97, 201, 23)" : "white";
                currentTarget = target_img;
                target_img.style.borderColor = "rgb(245 140 44)";
                if (!window.matchMedia('(min-width: 500px)').matches && navigator.userAgent.includes("Chrome")) {
                    target_img.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
                }
                $("#origtex").style.background = "url('" + media_path + "')";
                $("#origtex").style.width = "224px";
                $("#origtex").style.height = "224px";
                $("#origtex").style.backgroundSize = "100% 100%";
                let desc = document.createElement('p')
                desc.innerHTML = "Model Name: " + name;
                // desc.href = "https://www.robots.ox.ac.uk/~vgg/data/dtd/"
                $("#texhinttext").innerHTML = '';
                $("#texhinttext").appendChild(desc);

                const token = ++selectionToken;
                const src = await fetchModelData(name);
                if (token !== selectionToken || demoGen !== glsl.__demoGen) return; // superseded
                if (!src) return;                      // fetch failed; keep last model
                model = build_model(src);
                if (params.reset_upon_load) {
                    reset();
                }
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
        // The default thumbnail's click() (above) lazily fetches + loads the
        // default model; frame() tolerates model being null until it arrives.
        reset();
        reset_camera();
        frame();
    }

    init();

    // Fetch + decode a model's weights, caching the decoded data so re-selecting
    // the same model never hits the network again. Returns null if unavailable.
    async function fetchModelData(name) {
        if (modelDataCache.has(name)) return modelDataCache.get(name);
        try {
            const r = await fetch(params.models_dir + encodeURIComponent(name) + '.json');
            if (!r.ok) return null;
            const src = await r.json();
            for (const k in src) {
                if (src[k].data64 !== undefined) {
                    src[k].data = new Float32Array(
                        Uint8Array.from(atob(src[k].data64), c => c.charCodeAt(0)).buffer);
                    delete src[k].data64;
                }
            }
            modelDataCache.set(name, src);
            return src;
        } catch (e) {
            console.warn(`PBR: failed to load model "${name}":`, e);
            return null;
        }
    }

    function build_model(src) {
        // init NCA
        const [ch, ci] = src['nca.w1.weight'].shape, co = src['nca.w2.weight.T'].shape[1];
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
        const inc = [`const int C4 = ${C4}; const int D4=32/4;`];
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



    function reset() {
        nca_grid = glsl({
            seed: 42, FP: `
            FOut = FOut1 = FOut2 = FOut3 = vec4(0);
        `
        }, { size: [128, 128], layern: C4, format: 'rgba16f', story: 2, tag: 'grid' });
        // }, {size: [64, 64], layern: C4, format: 'rgba16f', story: 2, tag: 'grid'});
    }

    function brush(x, y) {
        const { nca } = model;
        glsl({
            ...nca, ...camera_uniforms, ...uniforms, x_pos: x, y_pos: y, FP: `
            vec4 vpos = vec4(XY.y, XY.x, 0.0, 1.0);
            vpos = projection * view * vpos;
            vpos.xy /= vpos.w;
            float dist = length(vpos.xy - vec2(x_pos, y_pos));
            if (dist < 0.15 * brush_size) {
                FOut = FOut1 = FOut2 = FOut3 = vec4(0.0);
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
            const mat3 Kx = mat3(-1,-2,-1, 0,0,0, 1,2,1);
            const mat3 Ky = mat3(-1,0,1, -2,0,2, -1,0,1);
            const mat3 Klap = mat3(1,2,1, 2,-12,2, 1,2,1);

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

            void fragment() {
                for (int i=0; i<C4; ++i) {
                    upd[i] = perc[i] = Src(I,i);
                    perc[i+C4*3] = Klap[1][1]*upd[i];
                }
                FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
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
        const { siren } = model;
        const scale = params.relativeScale;
        const [w, h] = nca_grid.size;
        siren_grid = glsl({
            nca_grid: nca_grid[0].linear, ...siren, scale: scale, FP: `
            vec4 A[D4], B[D4];
            vec2 sz = vec2(nca_grid_size().xy);
            // vec2 fetch_uv = UV+0.5/sz/scale;
            vec2 fetch_uv = UV;
            vec2 patch_coord = (fract(UV*sz)-0.5)*2.0;
            A[0].yx = patch_coord;
            for (int i=0; i<C4; ++i) {
                vec4 v = nca_grid(fetch_uv,i);
                A[i].zw = v.xy; A[i+1].xy = v.zw;
            }
            run_layer0(A, B); run_layer1(B, A);
            run_layer2(A, B); run_layer3(B, A);
            FOut = A[0]; FOut1 = A[1]; FOut2 = A[2];
        `
        }, {
            size: [w * scale, h * scale],
            format: 'rgba16f', layern: S4, tag: 'siren'
        })
    }

    function frame(time) {
        glsl.adjustCanvas();
        // Default model may still be fetching (lazy load); keep the loop alive.
        if (!model) {
            glsl({ Aspect: 'fit', Clear: 0.0, FP: `FOut = vec4(0.0, 0.0, 0.0, 1.0);` });
            glsl.animation_id = requestAnimationFrame(frame);
            return;
        }
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
        let bgcolor = 1.0;
        let mesh_size = uniforms.geom == 0 ? [1, 1]: [128 * params.relativeScale, 128 * params.relativeScale];
        glsl({
            T: siren_grid.linear, Mesh: mesh_size, ...uniforms, ...camera_uniforms, Aspect: 'fit',
            Clear: [bgcolor, bgcolor, bgcolor, 0.0],
            time, DepthTest: 1, MeshMode: 1, VP: `
            float height = T(UV,0).a;
            varying vec3 v_position;
            VPos = vec4(XY,0,1);
            float scaledHeight = (height - 0.5)*heightScale;
            if (geom==0.0) {
                // Keep the plane flat; relief comes from parallax occlusion mapping in the fragment shader.
                VPos.xyz = vec3(XY.y, XY.x , 0.0);                
            } else {
                VPos.xyz = vec3(XY.y, XY.x, scaledHeight);
            }
            // VPos.xy *= rot2(time*0.1);
            v_position = VPos.xyz;
            VPos = projection * view * VPos;
            `, FP: `
            vec3 fresnelSchlick(float cosTheta, vec3 F0) {
                return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
            }

            float DistributionGGX(vec3 N, vec3 H, float roughness) {
                float a = roughness*roughness;
                // float a = roughness;
                float a2     = a*a;
                float NdotH  = max(dot(N, H), 0.0);
                float NdotH2 = NdotH*NdotH;
                float num   = a2;
                float denom = (NdotH2 * (a2 - 1.0) + 1.0);
                denom = PI * denom * denom;
                return num / denom;
            }

            float GeometrySchlickGGX(float NdotV, float roughness) {
                float r = (roughness + 1.0);
                float k = (r*r) / 8.0;

                float num   = NdotV;
                float denom = NdotV * (1.0 - k) + k;
                return num / denom;
            }
            float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
                float NdotV = max(dot(N, V), 0.0);
                float NdotL = max(dot(N, L), 0.0);
                float ggx2  = GeometrySchlickGGX(NdotV, roughness);
                float ggx1  = GeometrySchlickGGX(NdotL, roughness);
                return ggx1 * ggx2;
            }

            vec2 parallaxOcclusionMapUV(vec2 uv, vec3 viewDirTS, float depthScale) {
                // Raymarch in UV space. Depth increases from 0..depthScale.
                // displacement = (1 - height) * depthScale
                // stop at the first depth where displacement <= depth
                const int NUM_STEPS = 32;

                float vdz = max(viewDirTS.z, 1e-4);
                vec2 P = viewDirTS.yx / vdz;

                // Convert an offset expressed in the plane's [-1,1] domain into UV (0..1)
                vec2 uvStepScale = vec2(0.5);

                bool found = false;
                vec2 bestUV = uv;
                float dp = depthScale * 0.5;

                for (int depthIndex = 0; depthIndex <= NUM_STEPS + 1; ++depthIndex) {
                    float depth = dp * float(depthIndex) / float(NUM_STEPS);
                    vec2 offsetUV = P * depth;
                    // vec2 uvSample = clamp(uv - offsetUV, vec2(0.0), vec2(1.0));
                    vec2 uvSample = uv - offsetUV;



                    float heightMap = T(uvSample, 0).a;
                    float displacement = (1.0 - heightMap) * dp;

                    if (!found && (displacement <= depth)) {
                        found = true;
                        bestUV = uvSample;
                    }
                }
                return bestUV;
            }

            void fragment() {
                vec3 point_light = vec3(0.7);
                vec3 ambient_light = vec3(0.5);
                // View direction used for lighting (on the displaced surface)
                vec3 V = normalize(camera_position - v_position);

                // Flat XY plane => constant tangent basis (T=x, B=y, N=z)

                // POM: use the undisplaced plane position (z=0) to avoid feedback distortions
                vec2 uvPOM = UV; 
                if (geom == 0.0) {
                    uvPOM = parallaxOcclusionMapUV(uvPOM, V, heightScale);
                    if (uvPOM.x < 0.0 || uvPOM.x > 1.0 || uvPOM.y < 0.0 || uvPOM.y > 1.0) {
                        FOut = vec4(0.0);
                        return;
                    }
                }

                
                vec4 v0=T(uvPOM,0), v1=T(uvPOM,1), v2=T(uvPOM,2);
                vec3 albedo = v0.rgb;
                float height = v0.a;
                float roughness = clamp(v1.x, 0.1, 1.0);
                float ao = clamp(v1.y, 0.05, 1.0);
                vec3 normal = vec3(v1.zw, v2.x);

                if (visMode == 1.0) {
                    FOut = vec4(albedo, 1.0);
                } else if (visMode==2.0) {
                    FOut.rgb = normal;
                } else if (visMode==3.0) {
                    FOut.rgb = vec3(height);
                } else if (visMode==4.0) {
                    FOut.rgb = vec3(ao);
                } else if (visMode==5.0) {
                    FOut.rgb = vec3(roughness);
                } else {
                    vec3 Nts = normalize(normal - 0.5);
                    vec3 N = vec3(-Nts.y, Nts.x, Nts.z); // Map tangent space normal to world space
                    vec3 light_position = vec3(0, 0, 2.0);
                    // vec3 light_position = normalize(camera_position)*2.0;
                    vec3 L = normalize(light_position - v_position);
                    vec3 H = normalize(V + L);

                    float distance = length(light_position - v_position);
                    float attenuation = 1.0 / (distance * distance);
                    vec3 radiance = point_light * attenuation * 15.0;

                    vec3 F0 = vec3(0.04);
                    float metallic = 0.0;
                    F0 = mix(F0, albedo, metallic);

                    float NDF = DistributionGGX(N, H, roughness);
                    float G = GeometrySmith(N, V, L, roughness);
                    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

                    vec3 kS = F;
                    vec3 kD = vec3(1.0) - kS;
                    kD *= 1.0 - metallic;

                    vec3 numerator = NDF * G * F;
                    float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
                    vec3 specular = numerator / denominator;

                    float NdotL = max(dot(N, L), 0.0);
                    vec3 Lo = (kD * albedo / PI + specular) * radiance * NdotL;

                    FOut.rgb = albedo * ao * ambient_light + Lo;
                    FOut.a = 1.0;

                }
                if (showWireframe) {
                    FOut.rgb = FOut.rgb + wireframe()*0.2;
                    FOut.a = 1.0;
                }
            }
        `
        });

        if (typeof onCanvasRendered === 'function') {
            onCanvasRendered();
        }

        glsl.animation_id = requestAnimationFrame(frame);
    }

}
