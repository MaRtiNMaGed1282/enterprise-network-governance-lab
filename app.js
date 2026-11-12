"use strict";

(function initializeLab() {
  const select = (selector, root = document) => root.querySelector(selector);
  const names = { allowed: "سماح", denied: "منع", unknown: "دليل غير كافٍ" };
  const results = { match: "مطابق", mismatch: "غير مطابق", inconclusive: "غير حاسم" };
  const colors = { match: "good", mismatch: "bad", inconclusive: "warn" };
  const views = ["network", "simulation", "controls", "scorecard", "course"];
  const storageKey = "enterprise-governance-lab-round-1";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const saved = readProgress();
  const retestKey = "enterprise-governance-lab-retest-v2";
  let retest = saved["T-03"] ? readRetest() : null;
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
        return item && Object.hasOwn(names, item.prediction) && Number.isFinite(item.at) && Number.isFinite(new Date(item.at).getTime());
      }).map(({ id }) => [id, raw[id]]));
    } catch {
      return {};
    }
  }

  function readRetest() {
    try {
      const value = JSON.parse(localStorage.getItem(retestKey));
      return value?.revision === "FW-REV2" && Number.isFinite(value.at) && Number.isFinite(new Date(value.at).getTime()) ? value : null;
    } catch { return null; }
  }

  function saveProgress() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
      localStorage.setItem(retestKey, JSON.stringify(retest));
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
    select("#retest-button").hidden = scenario.id !== "T-03" || !record || Boolean(retest);
    select("#retest-state").textContent = scenario.id === "T-03" && retest ? "إعادة الاختبار موثقة في سجل الأدلة. المسار الأساسي FW-BASE متاح للعرض مع الاحتفاظ بدليله الأصلي." : "";
    select("#scenario-title").textContent = scenario.title;
    const { rule, service } = GOVERNANCE.testDetails[scenario.id];
    select("#scenario-route").textContent = `المصدر: ${LAB.nodes[scenario.source].name} · الوجهة: ${LAB.nodes[scenario.destination].name} · الخدمة: ${service} · القاعدة: ${rule}`;
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
    select("#retest-button").disabled = Boolean(active);
    for (const input of form.elements.prediction) input.disabled = Boolean(active);
  }


  const controlId = '<bdi>A.8.22</bdi> · فصل الشبكات <bdi>(Segregation of networks)</bdi>';
  const code = value => `<bdi>${value}</bdi>`;
  const assessmentReference = '<a href="https://csrc.nist.gov/pubs/sp/800/53/a/r5/final">NIST SP 800-53A Rev. 5</a>';
  const reference = (id) => {
    const [, title, arabic] = GOVERNANCE.controls.find(row => row[0] === id);
    return `${code(id)} · ${arabic} ${code(`(${title})`)}`;
  };

  function renderEvidence() {
    const rows = LAB.scenarios.filter(({ id }) => saved[id]).map(scenario => {
      const { id } = scenario;
      const { rule, service, source, destination, revision, log } = GOVERNANCE.testDetails[id];
      const status = classify(scenario);
      const time = new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "medium" }).format(saved[id].at);
      return [
        `${code(id)} · ${scenario.title}<br>${code(rule)} · ${code(revision)}`,
        `من ${code(source)} إلى ${code(destination)}<br>${service}`,
        names[scenario.expected], names[scenario.observed],
        `<span class="result-${colors[status]}">${results[status]}</span>`,
        `${log ? code(log) : "لا يوجد سجل قرار"} · ${time}<br>${scenario.evidence}`
      ];
    });
    if (retest) rows.push([`${code("RT-03")} · إعادة اختبار ${code("T-03")}<br>${code("NET-03")} · ${code(retest.revision)}`, `من ${code("203.0.113.25")} إلى ${code("10.10.30.10")}<br>PostgreSQL (TCP 5432)`, names.denied, names.denied, '<span class="result-good">مطابق</span>', `${code("FW-2003")} · ${new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "medium" }).format(retest.at)}<br>نتيجة محاكاة بعد معالجة معتمدة CHG-021. تحقق الأمن من منع المسار.`]);
    select("#evidence").innerHTML = rows.length
      ? table(["الاختبار والمرجع", "المصدر ثم الوجهة", "المتوقع", "المرصود", "الحكم", "الدليل ووقت التشغيل"], rows)
      : '<p class="empty">شغّل أول اختبار لعرض النتيجة هنا.</p>';
  }

  function renderRaciPractice() {
    const activity = GOVERNANCE.raci.find(row => row[0] === "06");
    const roleChoices = Object.entries(GOVERNANCE.roles).map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
    return `<article class="panel"><h2>تمرين RACI · اختبار الضابط</h2><p>عيّن الأدوار الأربعة لنشاط التحقق بعد أن ينفّذ مهندس الشبكات تغييرًا معتمدًا. اختر ممثلًا واحدًا لكل دور في هذا التمرين.</p>
      <form id="raci-practice" class="risk-form" data-activity="${activity[0]}"><div class="facts">${["R المنفّذ", "A صاحب المساءلة", "C يُستشار", "I يُبلّغ"].map(label => `<label>${label}<select name="${label[0]}" required><option value="">اختر الدور</option>${roleChoices}</select></label>`).join("")}</div><button class="primary">تحقق من التوزيع</button><p id="raci-feedback" role="status"></p></form></article>`;
  }

  function checkRaci(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const [, , , expectedR, expectedA, consulted, informed] = GOVERNANCE.raci.find(row => row[0] === form.dataset.activity);
    const { R, A, C, I } = Object.fromEntries(new FormData(form));
    const output = select("#raci-feedback");
    if (new Set([R, A, C, I]).size < 4) {
      output.textContent = "وزّع الحروف على أدوار مختلفة في هذا النشاط.";
    } else if (R === expectedR && A === expectedA && consulted.includes(C) && informed.includes(I)) {
      output.textContent = "توزيع صحيح. الأمن يختبر، ومدير الأمن يعتمد النتيجة، ومنفّذ التغيير يُستشار.";
    } else {
      output.textContent = "راجع فصل المهام. الشبكات نفّذت التغيير، والأمن مسؤول عن التحقق المستقل. استشر طرفًا يقدّم مدخلات وأبلغ صاحب المصلحة بالنتيجة.";
    }
  }

  function renderControls() {
    const facts = [
      ["هدف العمل", "إبقاء التطبيق متاحًا للموظفين، وحماية سجلات المؤسسة من الوصول من مناطق غير معتمدة."],
      ["نطاق الضابط", "مناطق الموظفين والتطبيق والبيانات والدعم الخارجي والإدارة والمراقبة. يختبر المعمل العبور بين المناطق عند الجدار الناري."],
      ["السياسة POL-NET-01", "تُفصل المناطق حسب وظيفتها ومستوى الثقة. تُمنع الاتصالات بينها افتراضيًا. يُسمح بالتدفقات المبررة والمعتمدة فقط، ويُوثّق أي استثناء وتاريخ انتهائه."],
      ["مبرر الاختيار R-01", "اتصال غير مصرح به بين المناطق قد يعرّض البيانات للكشف أو التعديل. الضابط يعالج مسار الشبكة الذي قد يسمح بهذا الوصول."],
      ["دليل التصميم والتنفيذ", "خريطة معتمدة، ومصفوفة اتصال بإصدار محدد، وطلب تغيير معتمد، ومرجع لقواعد الجدار الناري قبل التغيير وبعده."],
      ["دليل التشغيل", "سجل اختبار يربط حالة الاختبار بالقاعدة، والمصدر والوجهة والخدمة، والوقت، والنتيجتين المتوقعة والمرصودة. يظل الاختبار غير حاسم إذا لم يكفِ الدليل."]
    ];
    const { roles, raci, matrix, controls, procedure } = GOVERNANCE;
    const roleKeys = Object.keys(roles);
    const raciRows = raci.map(([id, activity, output, responsible, accountable, consulted, informed]) => [
      `${code(`ACT-${id}`)} · ${activity}<small class="cell-detail">${output}</small>`,
      ...roleKeys.map(role => {
        const letter = role === responsible ? "R" : role === accountable ? "A" : consulted.includes(role) ? "C" : informed.includes(role) ? "I" : "—";
        return `<span class="raci-${letter}" dir="ltr">${letter}</span>`;
      })
    ]);
    const matrixRows = matrix.map(([id, source, dest, service, decision, reason, test]) => [
      code(id), source, dest, service, decision, reason,
      test ? `<a href="#simulation/${test}">${code(test)}</a>` : "قاعدة عامة"
    ]);
    select("#controls-stage").innerHTML = `<div class="stack">
      <article class="panel"><div class="panel-heading"><div><h2>${controlId}</h2><p>ISO/IEC 27001:2022 · Annex A | إرشادات التطبيق: ISO/IEC 27002:2022 §8.22</p></div><a href="#scorecard">مؤشرات الضابط ←</a></div>
      <div class="facts">${facts.map(([label, detail]) => `<div class="fact"><h3>${label}</h3><p>${detail}</p></div>`).join("")}</div>
      <p class="footnote">منهج التحقق: فحص الوثائق والإعدادات، ثم اختبار التدفقات المصرّح بها ومراجعة السجل. مرجع أسلوب التقييم: ${assessmentReference}.</p>
      <p class="footnote">هذا تطبيق تدريبي على شبكة محددة. ضوابط الهوية وصلاحيات قاعدة البيانات تحتاج اختبارات مستقلة. المراجع: <a href="https://www.iso.org/standard/27001">ISO/IEC 27001</a> · <a href="https://www.iso.org/standard/75652.html">ISO/IEC 27002</a>.</p></article>
      <article class="panel"><h2>مصفوفة الاتصالات المعتمدة · POL-NET-01</h2>${table(["القاعدة", "المصدر", "الوجهة", "الخدمة", "المتوقع", "المبرر", "الاختبار"], matrixRows)}</article>
      <article class="panel"><h2>الإجراء التشغيلي · PROC-NET-01</h2>${table(["الخطوة", "الإجراء والدليل المطلوب"], procedure)}</article>
      <article class="panel"><h2>مصفوفة المسؤوليات RACI</h2>
      <p class="footnote">الصف نشاط له مخرج، والعمود دور. R ينفّذ، A يُساءل عن النتيجة ويملك اعتمادها، C يُستشار قبل القرار، I يُبلّغ. لكل نشاط هنا منفّذ وصاحب مساءلة واحد. ينفّذ مهندس الشبكات التغيير، ويختبره محلل الأمن، وتعتمد نتيجة الاختبار إدارة الأمن.</p>
      <div class="raci-grid">${table(["النشاط والمخرج", ...Object.values(roles)], raciRows)}</div>
      <p class="footnote">يُسند مالك الخطر حسب نطاق التفويض. عند تجاوزه تُرفع الحالة إلى لجنة الحوكمة، ويُسجل قرارها ومدته وشروطه في سجل المخاطر.</p></article>
      ${renderRaciPractice()}
      <article class="panel"><h2>اختيار الضوابط ومبررات الانطباق</h2><p class="footnote">مقتطف تدريبي لاختيار الضوابط وفق ISO/IEC 27001 §6.1.3. يتضمن بيان قابلية التطبيق الفعلي الضوابط اللازمة ومبررات اختيارها وحالة تنفيذها ومبررات استبعاد ضوابط Annex A عند انطباق ذلك. تغطي المحاكاة الاتصالات المختبرة ضمن نطاقها.</p>
      ${table(["مرجع Annex A", "الاسم", "الدور في المعمل", "المبرر ونطاق التحقق", "حالة التحقق التدريبية"], controls.map(([id, title, arabic, type, scope]) => [code(id), `${arabic} · ${code(title)}`, type, scope, id === "A.8.22" ? "تُقاس الاتصالات المختارة في الجولة الحالية" : type === "تمرين" ? "مراجعة حالة تدريبية" : "يحتاج إلى تقييم مستقل"]))}</article></div>`;
    select("#raci-practice").addEventListener("submit", checkRaci);
  }

  function renderScorecard() {
    const completed = LAB.scenarios.filter(({ id }) => saved[id]);
    const effectiveStatus = scenario => scenario.id === "T-03" && retest ? "match" : classify(scenario);
    const matched = completed.filter(scenario => effectiveStatus(scenario) === "match").length;
    const conclusive = completed.filter(scenario => classify(scenario) !== "inconclusive").length;
    const total = LAB.scenarios.length;
    const percent = (count, all) => all ? `${Math.round(count * 100 / all)}%` : "—";
    const metric = (id, title, value, detail) => `<article class="metric"><h3>${title}</h3><strong>${code(value)}</strong><p>${detail}</p><a href="#scorecard" data-metric="${id}">عرض الاختبارات المحتسبة ↓</a></article>`;
    select("#scorecard-stage").innerHTML = `<div class="stack"><article class="panel"><h2>${controlId}</h2>
      <p class="subtle">المصدر: سجل الاختبارات المحاكى. الفترة: الجولة الحالية، بحسب إصدار الإعداد المعروض لكل حالة. يُحتسب RT-03 بدل T-03 عند توفره. يجمع هذا العرض أحدث دليل لكل حالة، وتُعرض نسخة الإعداد بجانب كل سجل. المالك: مدير الأمن. إعداد البيانات: محلل الأمن.</p>
      <div class="scorecards">${metric("match", "نسبة المطابقة", percent(matched, conclusive), `${matched} مطابقة من ${conclusive} اختبار حاسم. الهدف التدريبي 100%.`)}
      ${metric("coverage", "تغطية الأدلة", percent(conclusive, total), `${conclusive} اختبار حاسم من ${total} اختبارات مطلوبة. الهدف التدريبي 100%.`)}
      ${metric("open", "الاختبارات المفتوحة", total - conclusive, `${total - completed.length} غير منفّذ · ${completed.length - conclusive} غير حاسم`)}</div>
      ${matched < conclusive ? '<p class="notice">توجد مخالفة مؤكدة. تُسند المعالجة للتشغيل، ويعيد الأمن الاختبار قبل الإغلاق.</p>' : ""}
      <p class="footnote">طريقة عرض المؤشرات مستلهمة من <a href="https://bscdesigner.com/cybersecurity-strategy.htm">Cybersecurity Balanced Scorecard</a>. يحدد المعمل أهدافه التدريبية بحسب نطاق الاختبار.</p><p class="footnote">المطابقة = الاختبارات المطابقة ÷ الحاسمة. التغطية = الاختبارات الحاسمة ÷ المطلوبة. عند غياب الاختبارات الحاسمة تكون المطابقة غير قابلة للحساب. تُراجع النتائج بعد كل جولة وقبل إغلاق تغيير مؤثر.</p>
      </article><article class="panel" id="metric-details" tabindex="-1"><h2 id="metric-heading">الاختبارات ومتابعتها</h2><div id="metric-rows"></div></article></div>`;
    function showMetric(filter) {
      const label = { all: "الاختبارات ومتابعتها", match: "الاختبارات الحاسمة الداخلة في المطابقة", coverage: "الاختبارات المطلوبة لتغطية الأدلة", open: "الاختبارات غير المنفّذة أو غير الحاسمة" };
      select("#metric-heading").textContent = label[filter];
      const rows = LAB.scenarios.flatMap(scenario => {
        const status = saved[scenario.id] ? effectiveStatus(scenario) : "pending";
        if (filter === "match" && !["match", "mismatch"].includes(status)) return [];
        if (filter === "open" && !["pending", "inconclusive"].includes(status)) return [];
        const follow = { match: "احتفظ بالدليل.", mismatch: "الشبكات تعالج، والأمن يعيد الاختبار.", inconclusive: "الأمن يستكمل الدليل أو يعيد الاختبار.", pending: "الأمن ينفّذ الاختبار المطلوب." };
        return [[`<a href="#simulation/${scenario.id}">${code(scenario.id)} · ${scenario.title}</a>`, results[status] ?? "غير منفّذ", scenario.id === "T-03" && retest ? "أُعيد الاختبار بنجاح (RT-03). الانحراف الأول محفوظ في سجل الأدلة." : follow[status]]];
      });
      select("#metric-rows").innerHTML = rows.length ? table(["الاختبار", "الحالة", "الإجراء والمسؤول"], rows) : '<p class="empty">لا توجد اختبارات في هذه الفئة.</p>';
    }
    showMetric("all");
    for (const link of document.querySelectorAll("[data-metric]")) {
      link.addEventListener("click", event => {
        event.preventDefault();
        showMetric(link.dataset.metric);
        select("#metric-details").focus();
      });
    }
    renderRiskStatus();
  }

  const riskDraftKey = "enterprise-governance-lab-risk-draft-v2";

  function renderRiskStatus() {
    const risk = select("#risk-status");
    if (!risk) return;
    if (saved["T-03"] && retest) {
      risk.textContent = "RT-03 يثبت معالجة المسار المحدد. تظل متابعة الخطر مفتوحة لاستكمال T-04 وإعادة تقييم الخطر المتبقي واعتماد القرار.";
    } else if (saved["T-03"]) {
      risk.textContent = "مخالفة مرصودة في T-03. تظل المعالجة مفتوحة إلى حين تحقق مستقل من الحالة بعد التصحيح.";
    } else {
      risk.textContent = "بانتظار اختبار المسار من الطرف الخارجي إلى منطقة البيانات.";
    }
    const boundary = select("#profile-boundary");
    const logging = select("#profile-logging");
    const done = LAB.scenarios.filter(({ id }) => saved[id]).length;
    boundary.textContent = retest ? "RT-03 يثبت منع المسار بعد المعالجة. يُراجع باقي النطاق قبل إغلاق الفجوة." : saved["T-03"] ? "T-03 يرصد سماحًا مخالفًا للمصفوفة. المعالجة قيد المتابعة." : "النتيجة قيد التقييم حتى اختبار T-03.";
    logging.textContent = saved["T-04"] ? "T-04 يفتقد سجل القرار. يلزم استكمال الدليل." : `${done} اختبار منفّذ. يُراجع دليل T-04 عند تشغيل الحالة.`;
  }

  function renderCourse() {
    const modules = [
      ["١. مواءمة الأمن مع الاستراتيجية", "حدد الخدمة التي يجب أن تظل متاحة، والبيانات التي يجب حمايتها.", "موجز هدف العمل وحدود الوصول المقبول.", "#network"],
      ["٢. السياسات والإجراءات", "حوّل قاعدة الفصل إلى إجراء فيه طلب واعتماد وتنفيذ وتحقق.", "POL-NET-01 وPROC-NET-01.", "#controls"],
      ["٣. تقييم المخاطر", "قيّم احتمال الاتصال المخالف وأثره على سرية البيانات وسلامتها.", "سبب التقييم والأصل المتأثر وخطة المعالجة.", "#course"],
      ["٤. الضوابط الأمنية", "اختبر المسارات المسموحة والممنوعة وحدد كفاية كل دليل.", "نتائج موثقة ومتابعة إخفاقات الضابط.", "#simulation"],
      ["٥. NIST CSF 2.0", "قارن الحالة الحالية بالمستهدفة واربط الفجوات بمسؤول ودليل.", "ملف فجوات مبني على الأدلة.", "#course"],
      ["٦. سجل المخاطر", "حدّث سجل الخطر بعد قراءة النتائج وحدد مسار التصعيد.", "خطر متبقٍ، ومعالجة، ومسؤول، وموعد مراجعة.", "#course"]
    ];
    select("#course-stage").innerHTML = `<div class="stack"><article class="panel"><h2>محاور الدورة الستة</h2>
      ${table(["المحور", "المطلوب", "المخرج"], modules.map(([title, task, output, href]) => [`<a href="${href}">${title}</a>`, task, output]))}</article>
      <article class="panel"><h2>سجل المخاطر · حالة R-01</h2>
      <div class="facts"><div class="fact"><h3>الخطر والتقييم الأولي</h3><p>اتصال غير معتمد من منطقة خارجية إلى قاعدة البيانات. أثر مرتفع بسبب حساسية البيانات. الاحتمال متوسط كتقدير تدريبي قبل الاختبار.</p></div>
      <div class="fact"><h3>المعالجة ومالك الخطر</h3><p>مراجعة القاعدة، ومعالجة الانحراف، وتحقق مستقل. مالك الخدمة هو مالك الخطر المفوّض في هذا المثال. التصعيد إلى اللجنة إذا تجاوزت الحالة التفويض.</p></div>
      <div class="fact"><h3>الحالة الحالية</h3><p id="risk-status"></p></div>
      <div class="fact"><h3>الخطر المتبقي والقرار</h3><p>يعاد التقييم بعد المعالجة وإثباتها. يُسجل قرار القبول أو التصعيد وموعد المراجعة بواسطة صاحب الصلاحية.</p></div></div></article>
      <article class="panel"><h2>سجّل تقييمك ومبرر قرارك</h2><p class="footnote">مسودة تدريبية تُحفظ في هذا المتصفح. قيّم الخطر بعد مراجعة الأدلة وحدد المسؤول وموعد المراجعة.</p>
      <form id="risk-draft" class="risk-form"><div class="facts"><label>الاحتمال المتبقي<select name="likelihood" required><option value="">اختر</option><option>منخفض</option><option>متوسط</option><option>مرتفع</option></select></label><label>الأثر المتبقي<select name="impact" required><option value="">اختر</option><option>منخفض</option><option>متوسط</option><option>مرتفع</option></select></label><label>الإجراء المقترح<select name="decision" required><option value="">اختر</option><option>استكمال الدليل</option><option>معالجة وإعادة اختبار</option><option>رفع قرار القبول لصاحب الصلاحية</option></select></label><label>موعد المراجعة<input type="date" name="reviewDate" required></label></div><label>المالك والمبرر ومراجع الأدلة<textarea name="rationale" required maxlength="900" rows="3"></textarea></label><button class="primary">حفظ مسودة التقييم</button><p id="risk-draft-status" role="status"></p></form></article>
      <article class="panel"><h2>الربط مع NIST CSF 2.0</h2>
      ${table(["النتيجة", "الحالة الحالية", "الحالة المستهدفة", "مالك المتابعة"], [
        [code("PR.IR-01"), '<span id="profile-boundary"></span>', "منع التدفقات غير المعتمدة مع بقاء الخدمات المصرح بها.", "مدير التشغيل"],
        [code("PR.PS-04"), '<span id="profile-logging"></span>', "سجل قابل للمراجعة لكل اختبار مطلوب.", "مدير الأمن"],
        [code("PR.AA-05"), "حدود الصلاحية تظهر في تمريني المورّد وتغيير الدور.", "اعتماد الحقوق ومراجعتها وإنهاؤها حسب السياسة.", "مالك الخدمة"],
        [code("PR.DS-11"), "تُراجع نتيجة النسخ والاستعادة في تمرين الاستمرارية.", "اختبار الاستعادة موثّق وفي الهدف التدريبي.", "مدير التشغيل"]
      ])}<p class="footnote"><a href="https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20">مرجع NIST CSF 2.0</a> · <a href="https://csrc.nist.gov/pubs/sp/1301/final">دليل الحالة الحالية والمستهدفة</a></p></article>
      ${GOVERNANCE.exercises.map(exercise => `<article class="panel exercise"><h2>${exercise.title}</h2><p class="subtle">${reference(exercise.ref)}</p><p class="exercise-facts">${exercise.facts}</p>
      <form data-exercise="${exercise.id}"><fieldset><legend>ما قرارك بناءً على الدليل؟</legend>${exercise.choices.map((choice, index) => `<label><input type="radio" name="answer" value="${index}" required> ${choice}</label>`).join("")}</fieldset><button class="primary">راجع القرار</button></form><div class="exercise-result" role="status"></div></article>`).join("")}</div>`;
    const draftForm = select("#risk-draft");
    try {
      const draft = JSON.parse(localStorage.getItem(riskDraftKey));
      if (draft) for (const field of ["likelihood", "impact", "decision", "reviewDate", "rationale"]) {
        if (typeof draft[field] === "string") draftForm.elements[field].value = draft[field];
      }
    } catch { /* The form also works when browser storage is unavailable. */ }
    draftForm.addEventListener("submit", event => {
      event.preventDefault();
      try {
        localStorage.setItem(riskDraftKey, JSON.stringify(Object.fromEntries(new FormData(draftForm))));
        select("#risk-draft-status").textContent = "تم حفظ المسودة في هذا المتصفح.";
      } catch { select("#risk-draft-status").textContent = "تعذّر حفظ المسودة في هذا المتصفح."; }
    });
    for (const form of document.querySelectorAll("[data-exercise]")) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        const exercise = GOVERNANCE.exercises.find(item => item.id === form.dataset.exercise);
        const correct = Number(new FormData(form).get("answer")) === exercise.correct;
        select(".exercise-result", form.parentElement).innerHTML = `<p class="${correct ? "result-good" : "result-warn"}">${correct ? "القرار مناسب للدليل." : "راجع القرار في ضوء ما يثبته الدليل."}</p><p>${exercise.reason}</p><p><strong>السياسة</strong> · ${exercise.policy}</p><p><strong>الإجراء</strong> · ${exercise.procedure}</p><p><strong>الأدلة</strong> · ${exercise.evidence}</p><p><strong>RACI للنشاط</strong> · ${exercise.raci}</p><p><strong>المتابعة</strong> · ${exercise.owner}</p><p><strong>KPI مقترح</strong> · ${exercise.metric}</p>`;
      });
    }
    renderRiskStatus();
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

  function runSimulation(event, isRetest = false) {
    event.preventDefault();
    if (active) return;
    if (isRetest && (selectedScenario.id !== "T-03" || !saved["T-03"] || retest)) return;
    const prediction = isRetest ? "denied" : form.elements.prediction.value;
    if (!Object.hasOwn(names, prediction)) return;
    const scenario = isRetest ? { ...selectedScenario, observed: "denied", path: ["vendor", "firewall"] } : selectedScenario;
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
      if (isRetest) retest = { at: Date.now(), revision: "FW-REV2" };
      else if (scenario.id !== "T-03" || !retest) saved[scenario.id] = { prediction, at: Date.now() };
      saveProgress();
      renderScenario();
      if (isRetest) {
        simulationMap.setTrace(scenario, 1);
        select("#run-result").textContent = "RT-03: منع مطابق بعد المعالجة. دليل المحاولة الأصلية محفوظ.";
      }
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
    <div class="run-actions"><button type="submit" class="primary" id="run-button">تشغيل المحاكاة</button><p class="run-result" id="run-result" role="status"></p></div>
    <div class="run-actions followup"><button type="button" class="quiet" id="retest-button" hidden>حاكِ المعالجة المعتمدة وأعد الاختبار</button><p id="retest-state" class="subtle"></p></div>`;
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
  select("#retest-button").addEventListener("click", event => runSimulation(event, true));
  select("#reset").addEventListener("click", () => {
    stopAnimation();
    for (const id of Object.keys(saved)) delete saved[id];
    retest = null;
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
  renderCourse();
  renderScorecard();
  renderPage();
})();
