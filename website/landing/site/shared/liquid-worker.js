// The liquid shader compiles and renders away from the page's main thread.
const surfaces = new Map();
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    const surface = { canvas: data.canvas, width: data.width, height: data.height, dpr: data.dpr, opts: data.opts, visible: true, timer: 0 };
    surfaces.set(data.id, surface);
    render(surface, data.id).catch(() => postMessage({ id: data.id, type: "fallback" }));
    return;
  }
  const surface = surfaces.get(data.id);
  if (!surface) return;
  if (data.type === "visible") {
    surface.visible = data.visible;
    if (data.visible) surface.wake?.();
    else { clearTimeout(surface.timer); surface.timer = 0; }
  } else if (data.type === "resize") {
    surface.width = data.width; surface.height = data.height; surface.dpr = data.dpr;
    surface.resize?.();
  } else if (data.type === "pointer") {
    surface.tx = data.x * surface.scale; surface.ty = data.y * surface.scale;
  }
};

async function render(surface, id) {
  const { canvas, opts } = surface;
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return postMessage({ id, type: "fallback" });
  const derivatives = gl.getExtension("OES_standard_derivatives");
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const vs = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const fs = `${derivatives ? "#extension GL_OES_standard_derivatives : enable\n" : ""}precision highp float; uniform vec2 r; uniform float t; uniform vec2 m; uniform float zoom;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;mat2 R=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n(p);p=R*p*2.02;a*=.5;}return v;}
  float field(vec2 uv){
    vec2 q=vec2(fbm(uv+t*.04),fbm(uv+vec2(5.2,1.3)-t*.03));
    vec2 w=vec2(fbm(uv+3.5*q+vec2(1.7,9.2)+t*.06),fbm(uv+3.5*q+vec2(8.3,2.8)-t*.05));
    return fbm(uv+3.*w);
  }
  void main(){
    vec2 uv=(gl_FragCoord.xy-.5*r)/r.y; vec2 mm=(m-.5*r)/r.y;
    float d=length(uv-mm); uv-= (uv-mm)*.35*exp(-d*d*9.);
    uv*=zoom;
    float f=field(uv);
    ${derivatives ? "vec3 N=normalize(vec3(-dFdx(f)*r.y/zoom*.06,-dFdy(f)*r.y/zoom*.06,1.));" : "float e=.004; float fx=field(uv+vec2(e,0.)); float fy=field(uv+vec2(0.,e)); vec3 N=normalize(vec3((f-fx)/e*.06,(f-fy)/e*.06,1.));"}
    vec3 L=normalize(vec3(-.4,.6,.7)); float diff=max(dot(N,L),0.); float spec=pow(max(dot(reflect(-L,N),vec3(0,0,1)),0.),40.);
    float fres=pow(1.-N.z,1.5);
    vec3 film=.5+.5*cos(6.2831*(f*2.2+fres*1.5+vec3(0.,.33,.67)+t*.03));
    float band=smoothstep(.42,.75,f);
    float band2=smoothstep(.3,.8,f); vec3 col=vec3(.012)+band2*film*(.22+fres*2.6)+band*vec3(diff*.12)+spec*vec3(1.)*band;
    col*=1.-smoothstep(.55,1.25,length((gl_FragCoord.xy/r-.5)*vec2(r.x/r.y,1.)));
    gl_FragColor=vec4(pow(col,vec3(.9)),1.);
  }`;

  const sh = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; };
  const vertex = sh(gl.VERTEX_SHADER, vs), fragment = sh(gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (parallel) {
    while (!gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR))
      await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return postMessage({ id, type: "fallback" });
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const r = gl.getUniformLocation(program, "r"), t = gl.getUniformLocation(program, "t"), m = gl.getUniformLocation(program, "m"), z = gl.getUniformLocation(program, "zoom");
  surface.resize = () => {
    surface.scale = Math.min(surface.dpr || 1, .8, Math.sqrt(180000 / Math.max(1, surface.width * surface.height)));
    canvas.width = Math.max(1, Math.round(surface.width * surface.scale)); canvas.height = Math.max(1, Math.round(surface.height * surface.scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    surface.tx = surface.mx = canvas.width / 2; surface.ty = surface.my = canvas.height * .6;
  };
  surface.resize();
  const start = performance.now();
  let painted = false;
  function draw() {
    surface.timer = 0;
    if (!surface.visible) return;
    surface.mx += (surface.tx - surface.mx) * .12; surface.my += (surface.ty - surface.my) * .12;
    gl.uniform2f(r, canvas.width, canvas.height); gl.uniform1f(t, (performance.now() - start) / 1000 * (opts.speed || 1));
    gl.uniform2f(m, surface.mx, surface.my); gl.uniform1f(z, opts.zoom || 1.6); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.flush();
    if (!painted) { painted = true; postMessage({ id, type: "ready" }); }
    surface.timer = setTimeout(draw, 1000 / 30);
  }
  surface.wake = () => { if (!surface.timer && surface.visible) draw(); };
  surface.wake();
}
