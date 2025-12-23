
export function createDemoPBR(glsl, divId) {
    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);

    const canvas = $("#demo-canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    // const gui = new dat.GUI();

    const CHN = 16, C4 = CHN / 4, D4 = 32 / 4, S4 = 3;
    const H = 128, W = 128; // Size of the NCA grid
    let models, model;
    let nca_grid, siren_grid;


    const params = {
        models_path: './2d_pbr_demo/models.json',
        // models_path: './pbr_nca.json',
        model: 'Abstract_008',
        // model: 'Alex',
        // model: 'Sci-fi_Wall_010',
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
        geom: 0,
    };

    const camera = {
        theta: 45.0,
        phi: 30.0,
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
            reset_camera();
        }

        $('#zoomOut').onclick = () => {
            uniforms.zoom -= 0.5;
            $('#zoomIn').classList.remove("disabled");
            if (uniforms.zoom < -1.0) {
                uniforms.zoom = -1.0;
                $('#zoomOut').classList.add("disabled");
            }
            reset_camera();
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

        if (e.shiftKey) {

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
        const response = await fetch(params.models_path);
        // const response = await fetch('./growing_nca.json');
        models = await response.json();

        let gridBox = $('#target-shelf');
        gridBox.innerHTML = '';
        $('#origtex').innerHTML = '';
        $('#origtex').style = '';
        $('#texhinttext').innerHTML = '';
        for (const name of target_names) {

            for (const k in models[name]) {
                const src = models[name][k];
                src.data = new Float32Array(
                    Uint8Array.from(atob(src.data64), c => c.charCodeAt(0)).buffer);
                delete src.data64;
            }

            let media_path = "./2d_pbr_demo/target_images/" + name + "/rendered_white.jpg"
            console.log(media_path);
            media_path = media_path.replace(' + AutoCorr', '');


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
                desc.innerHTML = "Model Name: " + name;
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
        reset_camera();
        frame();
    }

    init();

    function load_model(name) {
        const src = models[name];
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
            ...nca, ...camera_uniforms, x_pos: x, y_pos: y, FP: `
            vec4 vpos = vec4(XY.x, XY.y, 0.0, 1.0);
            vpos = projection * view * vpos;
            vpos.xy /= vpos.w;
            float dist = length(vpos.xy - vec2(x_pos, y_pos));
            if (dist < 0.25) {
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
        glsl({
            T: siren_grid.linear, Mesh: [512, 512], ...uniforms, ...camera_uniforms, Aspect: 'fit',
            Clear: [bgcolor, bgcolor, bgcolor, 0.0],
            time, DepthTest: 1, MeshMode: 1, VP: `
            float height = T(UV,0).a;
            varying vec3 v_position;
            VPos = vec4(XY,0,1);
            float scaledHeight = height*heightScale;
            if (geom==0.0) {
                VPos.xyz = vec3(XY,scaledHeight);
            } else {
                VPos.xyz = torus(UV, 0.7, 0.2+scaledHeight);
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

            void fragment() {
                vec3 point_light = vec3(7.0);
                vec3 ambient_light = vec3(0.25);
                vec4 v0=T(UV,0), v1=T(UV,1), v2=T(UV,2);
                vec3 albedo = v0.rgb;
                float height = v0.a;
                float roughness = v1.x;
                float ao = v1.y;
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
                    vec3 N = normalize(normal - 0.5);
                    // vec3 N = normalize(vec3(0, 0, 1));
                    vec3 V = normalize(camera_position - v_position);
                    vec3 light_position = vec3(0, 0, 1) * 1.5;
                    vec3 L = normalize(light_position - v_position);
                    vec3 H = normalize(V + L);

                    float distance = length(light_position - v_position);
                    float attenuation = 1.0 / (distance * distance);
                    vec3 radiance = point_light * attenuation;

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

        glsl.animation_id = requestAnimationFrame(frame);
    }

    const target_names = [
        "Abstract_009",
        "Abstract_008",
        "Sci-Fi_Padded_Fabric_004",
        "Sci-Fi_Wall_012",
        "Sci-fi_Hose_005",
        "Sci-fi_Wall_004",
        "Sci-fi_Wall_005",
        "Sci-fi_Wall_009",
        "Sci-fi_Wall_010",
        "Sci-fi_Wall_010 + AutoCorr",
        "Skin_Lizard_002",
        "Rubber_Sole_001",
        "Rubber_Sole_001 + AutoCorr",
        "Rubber_Sole_003",
        "Rubber_Sole_003 + AutoCorr",
        "Abstract_Organic_004",
        "Abstract_Organic_006",
        "Bark_007",
        "Bricks_Terracotta_002",
        "Bricks_Terracotta_003",
        "Concrete_Blocks_005",
        "Concrete_Blocks_006",
        "Concrete_Blocks_008",
        "Concrete_Blocks_009",
        "Concrete_Blocks_012",
        "Concrete_Blocks_012 + AutoCorr",
        "Coral_001",
        "Coral_002",
        "Crystal_003",
        "Fabric_Padded_007",
        "Fabric_Padded_Polyester_002",
        "Fabric_Quilt_003",
        "Fabric_Quilt_003 + AutoCorr",
        "Glass_Stained_001",
        "Glass_Window_004",
        "Gravel_001",
        "Honeycomb_002",
        "Lava_005",
        "Lava_006",
        "Leather_Padded_001",
        "Leather_weave_002",
        "Metal_Corrugated_010",
        "Metal_Mesh_002",
        "Metal_Mesh_006",
        "Metal_Plate_Sci-fi_002",
        "Metal_Plate_Sci-fi_002 + AutoCorr",
        "Metal_Tiles_002",
        "Paper_Lantern_001",
        "Pavement_Brick_001",
        "Pebbles_025",
        "Pebbles_027",
        "Plastic_Tubes_001",
        "Pumpkin_001",
        "Rock_031",
        "Rocks_Hexagons_002",
        "Roof_Tiles_Terracotta_006",
        "Roof_Tiles_Terracotta_007",

        "Stone_Path_007",
        "Stylized_Cliff_Rock_001",
        "Stylized_Cliff_Rock_003",
        "Stylized_Crystal_002",
        "Stylized_Fur_001",
        "Stylized_Fur_002",
        "Stylized_Grass_003",
        "Stylized_Rocks_002",
        "Stylized_Stone_Floor_005",
        "Stylized_Thatched_Roof_001",
        "Stylized_Thatched_Roof_002",
        "Stylized_Wood_Tiles_001",
        "Stylized_blocks_001",
        "Stylized_blocks_001 + AutoCorr",
        "Substance_Graph",
        "Tiles_047",
        "Tiles_047 + AutoCorr",
        "Waffle_001",
        "Wall_Shells_001",
        "Wood_Acoustic_Panel_001",
        "Wood_Acoustic_Panel_001 + AutoCorr",
        "Wood_Ceiling_001",
        "Wood_Ceiling_001 + AutoCorr",
        "Wood_Chiseled_001",
        "Wood_Panel_003",
    ]

}
