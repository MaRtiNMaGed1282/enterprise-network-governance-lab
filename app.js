"use strict";

(function initializeLab() {
  const select = (selector, root = document) => root.querySelector(selector);
  const names = { allowed: "سماح", denied: "منع", unknown: "دليل غير كافٍ" };
  const results = { match: "مطابق", mismatch: "غير مطابق", inconclusive: "غير حاسم" };
  const colors = { match: "good", mismatch: "bad", inconclusive: "warn" };
  const views = ["network", "simulation", "controls", "scorecard"];
  const storageKey = "enterprise-governance-lab-round-1";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const saved = readProgress();
  let selectedScenario = LAB.scenarios[0];
  let selectedNode = "firewall";
  let runVersion = 0;
  let active = null;

  function readProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey));
      if (!raw || typeof raw !== "object") return {};
      return Object.fromEntries(LAB.scenarios.filter(({ id }) => {
        const item = raw[id];
        return item && Object.hasOwn(names, item.prediction) && Number.isFinite(item.at);
      }).map(({ id }) => [id, raw[id]]));
    } catch {
      return {};
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // The round remains usable in memory when storage is unavailable.
    }
  }

  function table(headers, rows) {
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="${headers[0]}"><table><thead><tr>${headers.map(text => `<th scope="col">${text}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(text => `<td>${text}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function createMap(root, onSelect) {
    const template = select("#map-template");
    root.append(template.content.cloneNode(true));
    const map = root.lastElementChild;
    const diagram = select(".diagram", map);
    select(".topology-label", map).textContent = `${Object.keys(LAB.nodes).length} NODES`;
    if (!onSelect) select(".panel-heading p", map).textContent = "تابع المسار بين مكوّنات الشبكة.";
    const canvas = select("canvas", map);
    const nodes = select(".nodes", map);
    const ctx = canvas.getContext("2d");
    let trace = null;
    let fraction = 0;
    let selected = null;

    for (const [id, node] of Object.entries(LAB.nodes)) {
      const button = document.createElement("button");
      button.className = "node";
      button.type = "button";
      button.dataset.node = id;
      button.style.left = `${node.x}%`;
      button.style.top = `${node.y}%`;
      button.innerHTML = `<span class="node-symbol" aria-hidden="true">${node.symbol}</span><strong dir="rtl">${node.name}</strong><small>${node.label}</small>`;
      if (onSelect) {
        button.addEventListener("click", () => onSelect(id));
        button.setAttribute("aria-pressed", "false");
      } else {
        button.tabIndex = -1;
        button.disabled = true;
      }
      nodes.append(button);
    }

    function paint() {
      const width = diagram.clientWidth;
      const height = diagram.clientHeight;
      if (!width || !height || !ctx) return;
      const scale = Math.min(devicePixelRatio, 2);
      const bitmapWidth = Math.round(width * scale);
      const bitmapHeight = Math.round(height * scale);
      if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const point = id => [LAB.nodes[id].x * width / 100, LAB.nodes[id].y * height / 100];
      const segment = (from, to, color, weight, dashed = false) => {
        ctx.setLineDash(dashed ? [5, 5] : []);
        ctx.beginPath();
        ctx.moveTo(...from);
        ctx.lineTo(...to);
        ctx.strokeStyle = color;
        ctx.lineWidth = weight;
        ctx.stroke();
      };
      for (const [from, to] of LAB.edges) {
        segment(point(from), point(to), "#426168", 1.3, to === "monitor");
      }
      if (!trace) return;
      const steps = trace.path.length - 1;
      const progress = fraction * steps;
      const edge = Math.min(Math.floor(progress), steps - 1);
      const portion = progress - edge;
      const [fromX, fromY] = point(trace.path[edge]);
      const [toX, toY] = point(trace.path[edge + 1]);
      const cursor = [fromX + (toX - fromX) * portion, fromY + (toY - fromY) * portion];
      const color = fraction < 1 ? "#60c7d1" : trace.observed === "allowed" ? "#8df4ce" : "#ffd68b";
      for (let i = 0; i < edge; i += 1) segment(point(trace.path[i]), point(trace.path[i + 1]), color, 3);
      segment([fromX, fromY], cursor, color, 3);
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(...cursor, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function setTrace(scenario, progress) {
      trace = scenario;
      fraction = progress;
      for (const button of nodes.children) {
        const step = trace?.path.indexOf(button.dataset.node) ?? -1;
        button.classList.toggle("active", step >= 0 && step <= fraction * (trace.path.length - 1));
        for (const status of Object.keys(names)) {
          button.classList.toggle(status, trace?.observed === status && fraction === 1 && button.dataset.node === trace.path.at(-1));
        }
      }
      paint();
    }

    function setSelected(id) {
      if (selected === id) return;
      selected = id;
      for (const button of nodes.children) button.setAttribute("aria-pressed", String(button.dataset.node === id));
    }

    const observer = new ResizeObserver(paint);
    observer.observe(diagram);
    return { setTrace, setSelected, paint };
  }

  function inspectNode(id) {
    selectedNode = id;
    const node = LAB.nodes[id];
    inspect.innerHTML = `<p class="label" dir="ltr">${node.label}</p><h2>${node.name}</h2><p>${node.detail}</p>
      <dl><dt>العنوان أو النطاق</dt><dd><bdi>${node.address}</bdi></dd>
      <dt>المنطقة</dt><dd>${node.zone}</dd><dt>الخدمة أو البروتوكول</dt><dd>${node.service}</dd></dl>`;
    networkMap.setSelected(id);
  }

  function classify(scenario) {
    if (scenario.observed === "unknown") return "inconclusive";
    return scenario.observed === scenario.expected ? "match" : "mismatch";
  }

  function renderScenario() {
    const scenario = selectedScenario;
    for (const button of select("#scenario-list").children) {
      button.setAttribute("aria-pressed", String(button.dataset.scenario === scenario.id));
    }
    const record = saved[scenario.id];
    select("#scenario-title").textContent = scenario.title;
    select("#scenario-route").textContent = `المصدر: ${LAB.nodes[scenario.source].name} · الوجهة: ${LAB.nodes[scenario.destination].name}`;
    for (const input of form.elements.prediction) input.checked = record?.prediction === input.value;
    select("#run-result").textContent = record
      ? `${names[scenario.observed]} · ${results[classify(scenario)]} · ${record.prediction === scenario.expected ? "توقعك مطابق للسياسة" : `التوقع وفق السياسة: ${names[scenario.expected]}`}`
      : "اختر توقعك لتشغيل الحالة.";
    simulationMap.setTrace(record ? scenario : null, record ? 1 : 0);
    refreshRunControls();
  }

  function refreshRunControls() {
    select("#run-button").disabled = Boolean(active) || !form.elements.prediction.value;
    select("#reset").disabled = Boolean(active) || Object.keys(saved).length === 0;
    for (const input of form.elements.prediction) input.disabled = Boolean(active);
  }

  function renderEvidence() {
    const rows = LAB.scenarios.filter(({ id }) => saved[id]).map(scenario => {
      const status = classify(scenario);
      const time = new Intl.DateTimeFormat("ar-EG", { timeStyle: "medium" }).format(saved[scenario.id].at);
      return [
        `<bdi>${scenario.id}</bdi> · ${scenario.title}`,
        names[scenario.expected],
        names[scenario.observed],
        `<span class="result-${colors[status]}">${results[status]}</span>`,
        `<strong>${time}</strong><br>${scenario.evidence}`
      ];
    });
    select("#evidence").innerHTML = rows.length
      ? table(["الاختبار", "المتوقع وفق السياسة", "المرصود", "الحكم", "الدليل ووقت الاختبار"], rows)
      : '<p class="empty">شغّل أول اختبار لعرض النتيجة هنا.</p>';
  }

  function renderScorecard() {
    const scenarios = LAB.scenarios.filter(({ id }) => saved[id]);
    const matched = scenarios.filter(scenario => classify(scenario) === "match").length;
    const conclusive = scenarios.filter(scenario => classify(scenario) !== "inconclusive").length;
    const total = LAB.scenarios.length;
    const percent = (count, all) => all ? `${Math.round(count * 100 / all)}%` : "—";
    const metric = (title, value, detail) => `<article class="metric"><h3>${title}</h3><strong><bdi>${value}</bdi></strong><p>${detail}</p></article>`;
    const attention = scenarios.filter(scenario => classify(scenario) !== "match");
    select("#scorecard-stage").innerHTML = `<div class="panel"><h2>تقييد الوصول إلى قاعدة البيانات</h2><p class="subtle">المسؤول عن مراجعة المؤشرات: فريق الأمن · بعد كل جولة اختبار</p>
      <div class="scorecards">${metric("مطابقة الاختبارات الحاسمة", percent(matched, conclusive), `${matched} مطابقة من ${conclusive} اختبار حاسم`)}
      ${metric("تغطية الاختبارات بأدلة كافية", percent(conclusive, total), `${conclusive} اختبار حاسم من ${total} اختبارات مطلوبة`)}
      ${metric("الاختبارات غير المنفّذة", total - scenarios.length, `${scenarios.length - conclusive} اختبار منفّذ بنتيجة غير حاسمة`)}</div>
      ${attention.length ? '<p class="notice">توجد نتائج تحتاج معالجة أو أدلة إضافية قبل إغلاق المراجعة.</p>' : ""}
      ${scenarios.length ? table(["الدليل المرتبط", "الحكم", "المتابعة"], scenarios.map(scenario => {
        const status = classify(scenario);
        return [
          `<a href="#simulation/${scenario.id}"><bdi>${scenario.id}</bdi> · ${scenario.title}</a>`,
          `<span class="result-${colors[status]}">${results[status]}</span>`,
          { match: "احتفظ بالدليل في سجل الاختبار.", mismatch: "الشبكات تعالج النتيجة، والأمن يعيد الاختبار.", inconclusive: "الأمن يستكمل السجل أو يعيد الاختبار." }[status]
        ];
      })) : '<p class="empty">شغّل المحاكاة لتظهر المؤشرات والأدلة المرتبطة بها.</p>'}</div>`;
  }

  function renderControls() {
    const facts = [
      ["الخطر", "وصول مباشر خارج المسارات المعتمدة قد يعرض سجلات المؤسسة للكشف أو التعديل."],
      ["السياسة", "يقتصر الوصول المباشر لقاعدة البيانات على الأنظمة والأدوار المعتمدة. يصل الموظفون إلى البيانات عبر التطبيق."],
      ["الضابط", "يقيد الجدار الناري مسارات الاتصال وفق مصفوفة معتمدة ويسجل قرارات السماح والمنع."],
      ["الإجراء", "وثّق المسار، وراجع مبرر الوصول، واعتمد التغيير، ثم اختبر السماح والمنع وسجّل النتيجة. أعد الاختبار بعد المعالجة."],
      ["الدليل", "راجع مصدر الاتصال ووجهته ونتيجة السجل وقارنها بالمصفوفة. سجّل الحالة غير حاسمة إذا تعذّر الحصول على الدليل."],
      ["المؤشرات", "قارن نتائج الاختبارات الحاسمة بالمصفوفة، وقِس تغطية الأدلة لجميع الاختبارات المطلوبة."]
    ];
    select("#controls-stage").innerHTML = `<div class="stack"><article class="panel"><div class="panel-heading"><div><h2>تقييد الوصول إلى قاعدة البيانات</h2><p>ضابط مرتبط بمسارات الاتصال في المحاكاة.</p></div><a href="#scorecard">مؤشرات الضابط ←</a></div>
      <div class="facts">${facts.map(([label, detail]) => `<div class="fact"><h3>${label}</h3><p>${detail}</p></div>`).join("")}</div></article>
      <article class="panel"><h2>مصفوفة الاتصالات المعتمدة</h2><p class="footnote">ترجع الاختبارات إلى هذه المصفوفة لتحديد النتيجة المتوقعة.</p>
      ${table(["المصدر", "الوجهة", "القرار"], LAB.scenarios.slice(0, 3).map(scenario => [LAB.nodes[scenario.source].name, LAB.nodes[scenario.destination].name, names[scenario.expected]]))}</article>
      <article class="panel"><h2>مصفوفة المسؤوليات RACI</h2><p class="footnote">المنفّذ R · صاحب المساءلة A · يُستشار C · يُبلّغ I</p>
      ${table(["النشاط", "R", "A", "C", "I"], LAB.raci)}</article></div>`;
  }

  function stopAnimation() {
    runVersion += 1;
    if (active) cancelAnimationFrame(active.frame);
    active = null;
  }

  function switchScenario(id) {
    const scenario = LAB.scenarios.find(item => item.id === id);
    if (scenario && scenario !== selectedScenario) {
      stopAnimation();
      selectedScenario = scenario;
      renderScenario();
    }
  }

  function runSimulation(event) {
    event.preventDefault();
    if (active) return;
    const prediction = form.elements.prediction.value;
    if (!Object.hasOwn(names, prediction)) return;
    const scenario = selectedScenario;
    const version = ++runVersion;
    const duration = reducedMotion.matches ? 0 : 850 * (scenario.path.length - 1);
    let start = null;
    active = { frame: 0 };
    refreshRunControls();
    select("#run-result").textContent = "جاري تتبّع المسار…";

    const tick = (time) => {
      if (version !== runVersion) return;
      start ??= time;
      const fraction = duration ? Math.min((time - start) / duration, 1) : 1;
      simulationMap.setTrace(scenario, fraction);
      if (fraction < 1) {
        active.frame = requestAnimationFrame(tick);
        return;
      }
      active = null;
      saved[scenario.id] = { prediction, at: Date.now() };
      saveProgress();
      renderScenario();
      renderEvidence();
      renderScorecard();
    };
    active.frame = requestAnimationFrame(tick);
  }

  function renderPage() {
    const [fragment, scenarioId] = location.hash.slice(1).split("/");
    const page = views.includes(fragment) ? fragment : "network";
    for (const view of views) select(`#view-${view}`).hidden = view !== page;
    for (const link of document.querySelectorAll("nav [data-page]")) {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (page === "simulation") switchScenario(scenarioId);
    if (page === "network") networkMap.paint();
    if (page === "simulation") simulationMap.paint();
  }

  const networkStage = select("#network-stage");
  const networkMap = createMap(networkStage, inspectNode);
  const inspect = document.createElement("article");
  inspect.className = "panel inspect";
  inspect.setAttribute("aria-live", "polite");
  networkStage.append(inspect);

  const simulationStage = select("#simulation-stage");
  const simulationMap = createMap(simulationStage);
  const form = document.createElement("form");
  form.className = "panel run-panel";
  form.innerHTML = `<h2 id="scenario-title"></h2><p class="subtle" id="scenario-route"></p>
    <fieldset><legend>ما النتيجة المتوقعة وفق السياسة؟</legend>
    <label><input type="radio" name="prediction" value="allowed"> سماح</label>
    <label><input type="radio" name="prediction" value="denied"> منع</label></fieldset>
    <div class="run-actions"><button type="submit" class="primary" id="run-button">تشغيل المحاكاة</button><p class="run-result" id="run-result" role="status"></p></div>`;
  simulationStage.append(form);

  const scenarioList = select("#scenario-list");
  for (const scenario of LAB.scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scenario";
    button.dataset.scenario = scenario.id;
    button.innerHTML = `<strong>${scenario.title}</strong><small>${scenario.detail}</small>`;
    button.addEventListener("click", () => {
      location.hash = `simulation/${scenario.id}`;
      switchScenario(scenario.id);
    });
    scenarioList.append(button);
  }

  form.addEventListener("change", refreshRunControls);
  form.addEventListener("submit", runSimulation);
  select("#reset").addEventListener("click", () => {
    stopAnimation();
    for (const id of Object.keys(saved)) delete saved[id];
    saveProgress();
    renderScenario();
    renderEvidence();
    renderScorecard();
  });
  window.addEventListener("hashchange", renderPage);
  inspectNode(selectedNode);
  renderScenario();
  renderEvidence();
  renderControls();
  renderScorecard();
  renderPage();
})();
