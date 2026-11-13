"use strict";

(function initializeLab() {
  const select = (selector, root = document) => root.querySelector(selector);
  const names = { allowed: "سماح", denied: "منع", unknown: "دليل غير كافٍ" };
  const results = { match: "مطابق", mismatch: "غير مطابق", inconclusive: "غير حاسم" };
  const colors = { match: "good", mismatch: "bad", inconclusive: "warn" };
  const views = ["network", "simulation", "controls", "scorecard", "course", "workflow", "permissions", "submission"];
  const storageKey = "enterprise-governance-lab-round-1";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const saved = readProgress();
  const workbenchKey = "enterprise-governance-lab-workbench-v3";
  const stored = readWorkbench();
  const workflow = saved["T-03"] && stored.workflow ? stored.workflow : {...emptyWorkflow(), raciAnswers:stored.workflow?.raciAnswers ?? {}, raciPassed:stored.workflow?.raciPassed === true};
  const currentResults = workflow.step === 3 ? (stored.currentResults ?? {}) : {};
  const permissionResults = stored.permissionResults ?? {};
  let submissionDraft = stored.submissionDraft ?? {};
  let verificationMode = workflow.step === 3;
  function emptyWorkflow() {
    return {step:0, times:{}, reviewed:[], raciPassed:false, raciAnswers:{}, decision:null};
  }
  function readWorkbench() {
    try { return JSON.parse(localStorage.getItem(workbenchKey)) ?? {}; }
    catch { return {}; }
  }
  function currentTestId(id) { return id.replace("T-", "RT-"); }
  function currentLogId(id) { return WORKBENCH.revision[id][1]; }
  function activeScenario(scenario, revised = verificationMode) {
    if (!revised) return scenario;
    const [observed,,evidence] = WORKBENCH.revision[scenario.id];
    return {...scenario,observed,evidence,path:observed === "denied" ? [scenario.source,"firewall"] : scenario.path};
  }
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

  function saveProgress() {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); }
    catch { /* The round remains usable in memory. */ }
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
    const record = verificationMode ? currentResults[scenario.id] : saved[scenario.id];
    const evaluated = activeScenario(scenario);
    select("#revision-select").value = verificationMode ? "current" : "baseline";
    select("#revision-select").querySelector('[value="current"]').disabled = workflow.step < 3;
    select("#simulation-workflow").hidden = scenario.id !== "T-03";
    select("#revision-in-use").textContent = verificationMode ? "FW-REV2" : "FW-BASE";
    select("#scenario-title").textContent = scenario.title;
    const { rule, service } = GOVERNANCE.testDetails[scenario.id];
    select("#scenario-route").textContent = `المصدر: ${LAB.nodes[scenario.source].name} · الوجهة: ${LAB.nodes[scenario.destination].name} · الخدمة: ${service} · القاعدة: ${rule} · الاختبار: ${verificationMode ? currentTestId(scenario.id) : scenario.id}`;
    for (const input of form.elements.prediction) input.checked = record?.prediction === input.value;
    select("#run-result").textContent = record
      ? `${names[evaluated.observed]} · ${results[classify(evaluated)]} · ${record.prediction === scenario.expected ? "توقعك مطابق للسياسة" : `التوقع وفق السياسة: ${names[scenario.expected]}`}`
      : "اختر توقعك لتشغيل الحالة.";
    simulationMap.setTrace(record ? evaluated : null, record ? 1 : 0);
    refreshRunControls();
  }

  function refreshRunControls() {
    select("#run-button").disabled = Boolean(active) || !form.elements.prediction.value;
    select("#reset").disabled = Boolean(active) || Object.keys(saved).length === 0;
    select("#revision-select").disabled = Boolean(active);
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
    const rows = [];
    for (const [records, revised] of [[saved,false],[currentResults,true]]) {
      for (const scenario of LAB.scenarios) {
        const {id} = scenario;
        if (!records[id]) continue;
        const {rule,service,source,destination,revision,log} = GOVERNANCE.testDetails[id];
        const evaluated = activeScenario(scenario,revised);
        const status = classify(evaluated);
        rows.push([
          `${code(revised ? currentTestId(id) : id)} · ${scenario.title}<br>${code(rule)} · ${code(revised ? "FW-REV2" : revision)}`,
          `من ${code(source)} إلى ${code(destination)}<br>${service}`,
          names[scenario.expected], names[evaluated.observed],
          `<span class="result-${colors[status]}">${results[status]}</span>`,
          `${revised ? code(currentLogId(id)) : log ? code(log) : "لا يوجد سجل قرار"} · ${timeLabel(records[id].at)}<br>${evaluated.evidence}`
        ]);
      }
    }
    select("#evidence").innerHTML = rows.length ? table(["الاختبار والمرجع","المصدر ثم الوجهة","المتوقع","المرصود","الحكم","الدليل ووقت التشغيل"],rows)
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
    const summary = (records,revised) => {
      const statuses = LAB.scenarios.map(scenario=>records[scenario.id] ? classify(activeScenario(scenario,revised)) : "pending");
      const matched = statuses.filter(status=>status==="match").length;
      const conclusive = statuses.filter(status=>status==="match" || status==="mismatch").length;
      return {matched,conclusive,total:statuses.length};
    };
    const baseline = summary(saved,false);
    const current = summary(currentResults,true);
    const percent = (count,total) => total ? Math.round(100*count/total)+"%" : "—";
    const metric = (title,value,detail) => `<article class="metric"><h3>${title}</h3><strong><bdi>${value}</bdi></strong><p>${detail}</p></article>`;
    const cards = ({matched,conclusive,total}) => `<div class="scorecards">${metric("مطابقة الاختبارات الحاسمة",percent(matched,conclusive),`${matched} من ${conclusive} اختبار حاسم`)}
      ${metric("تغطية الأدلة",percent(conclusive,total),`${conclusive} من ${total} اختبارات مطلوبة`)}
      ${metric("اختبارات بلا نتيجة حاسمة",total-conclusive,"تتضمن الاختبارات غير المنفذة وغير الحاسمة.")}</div>`;
    select("#scorecard-stage").innerHTML = `<div class="stack"><article class="panel" id="baseline-score"><h2>${controlId}</h2>
      <h3>خط الأساس · FW-BASE</h3>${cards(baseline)}</article>
      <article class="panel" id="current-score"><h2>الإعداد بعد المعالجة · FW-REV2</h2>
      <p id="verification-status" class="${fullVerification() ? "result-good" : "notice"}">${workflow.step < 3 ? "الإصدار الجديد بانتظار تنفيذ التغيير." : fullVerification() ? "نجحت جميع الاختبارات المطلوبة على الإصدار الحالي ضمن نطاق المعمل." : "التحقق من الإصدار الحالي غير مكتمل."}</p>
      <p class="footnote">المطابقة تقيس الاختبارات الحاسمة فقط. تُقرأ مع التغطية وحالة التحقق من الإصدار.</p><p id="remediation-status">${currentResults["T-03"] ? "تحقّق إصلاح مسار T-03 بإعادة الاختبار RT-03." : "إصلاح مسار T-03 بانتظار إعادة الاختبار."}</p>
      ${workflow.step===3 ? cards(current) : ""}
      <p class="footnote">المطابقة = المطابق ÷ الحاسم. التغطية = الحاسم ÷ المطلوب. الهدف التدريبي 100% لكل مؤشر. المصدر: سجل الاختبارات. المالك: مدير الأمن. تُراجع النتيجة بعد كل جولة، وتُحال المخالفات للتشغيل لإعادة المعالجة والتحقق.</p></article>
      <article class="panel"><h2>الأدلة حسب الإصدار</h2>
      ${table(["الحالة","FW-BASE","FW-REV2"],LAB.scenarios.map(scenario=>[
        scenario.title,
        `<a href="#simulation/${scenario.id}/base">${code(scenario.id)} · ${saved[scenario.id] ? results[classify(scenario)] : "غير منفّذ"}</a>`,
        workflow.step === 3 ? `<a href="#simulation/${scenario.id}/current">${code(currentTestId(scenario.id))} · ${currentResults[scenario.id] ? results[classify(activeScenario(scenario,true))] : "غير منفّذ"}</a>` : "بانتظار التنفيذ"
      ]))}</article></div>`;
    renderRiskStatus();
  }

  const riskDraftKey = "enterprise-governance-lab-risk-draft-v2";

  function renderRiskStatus() {
    const risk = select("#risk-status");
    if (!risk) return;
    const closed = workflow.decision?.value === "close";
    const escalated = workflow.decision?.value === "escalate";
    risk.textContent = closed ? "أُغلقت مخالفة الاختبار بعد تحقق الإصدار. يظل قبول الخطر المتبقي قرارًا منفصلًا ضمن التفويض."
      : escalated ? "المخالفة مُصعّدة للمراجعة. يظل الخطر قيد التقييم."
      : fullVerification() ? "اكتمل التحقق من الإصدار في نطاق المعمل. راجع ملف الأدلة وسجّل قرار الإغلاق."
      : currentResults["T-03"] ? "RT-03 يؤكد المعالجة لهذا المسار. لا يزال التحقق من الإصدار غير مكتمل."
      : saved["T-03"] ? "رُصدت مخالفة في T-03. تابع إجراءات التغيير والتحقق المستقل."
      : "بانتظار اختبار المسار من الطرف الخارجي إلى منطقة البيانات.";
    select("#profile-boundary").textContent = fullVerification() ? "نجحت اختبارات حدود الشبكة ضمن نطاق FW-REV2." : risk.textContent;
    select("#profile-logging").textContent = currentResults["T-04"] ? "RT-04 يوثق وصول سجل القرار بعد المعالجة." : saved["T-04"] ? "T-04 يفتقد سجل القرار في FW-BASE." : "دليل اكتمال سجل القرار بانتظار تشغيل الحالة.";
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

  function runSimulation(event) {
    event.preventDefault();
    if (active) return;
    const prediction = form.elements.prediction.value;
    if (!["allowed","denied"].includes(prediction)) return;
    const revised = verificationMode;
    const scenario = activeScenario(selectedScenario,revised);
    const version = ++runVersion;
    const duration = reducedMotion.matches ? 0 : 850 * (scenario.path.length - 1);
    let start = null;
    active = {frame:0};
    refreshRunControls();
    select("#run-result").textContent = "جاري تتبّع المسار…";
    const tick = time => {
      if (version !== runVersion) return;
      start ??= time;
      const fraction = duration ? Math.min((time-start)/duration,1) : 1;
      simulationMap.setTrace(scenario,fraction);
      if (fraction < 1) { active.frame = requestAnimationFrame(tick); return; }
      active = null;
      const records = revised ? currentResults : saved;
      if (!records[scenario.id]) records[scenario.id] = {prediction,at:Date.now()};
      else records[scenario.id].prediction = prediction;
      saveProgress();
      persistWorkbench();
      renderScenario();
      renderEvidence();
      renderWorkflow();
      renderScorecard();
      refreshSubmissionEvidence();
    };
    active.frame = requestAnimationFrame(tick);
  }

  function renderPage() {
    const [fragment, scenarioId, revision] = location.hash.slice(1).split("/");
    const page = views.includes(fragment) ? fragment : "network";
    for (const view of views) select(`#view-${view}`).hidden = view !== page;
    for (const link of document.querySelectorAll("nav [data-page]")) {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (page === "simulation") {
      if (revision === "base" || revision === "current") {
        const nextMode = revision === "current" && workflow.step === 3;
        if (verificationMode !== nextMode) { stopAnimation(); verificationMode = nextMode; renderScenario(); }
      }
      switchScenario(scenarioId);
    }
    if (page === "network") networkMap.paint();
    if (page === "simulation") simulationMap.paint();
  }


  const stageNames = ["طلب التغيير", "الاعتماد", "تنفيذ الإصدار", "التحقق المستقل"];
  const evidenceTypes = {request:"نطاق الطلب ومبرره",approval:"اعتماد التنفيذ",revision:"الإصدار المطبّق",original:"نتيجة المسار قبل المعالجة",retest:"نتيجة المسار بعد المعالجة"};
  const timeLabel = value => new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "medium" }).format(value);
  const evidenceReady = key => key === "original" ? Boolean(saved["T-03"]) : key === "retest" ? Boolean(currentResults["T-03"]) : workflow.step > WORKBENCH.evidence.findIndex(row => row[3] === key);
  const allEvidenceReviewed = () => WORKBENCH.evidence.every(([, , , key]) => workflow.reviewed.includes(key) && evidenceReady(key));
  const fullVerification = () => workflow.step === 3 && LAB.scenarios.every(scenario => currentResults[scenario.id] && classify(activeScenario(scenario, true)) === "match");

  function persistWorkbench() {
    try {
      localStorage.setItem(workbenchKey, JSON.stringify({workflow, currentResults, permissionResults, submissionDraft}));
      return true;
    } catch { return false; }
  }

  function renderWorkflow() {
    const target = select("#workflow-stage");
    target.innerHTML = `<div class="stack">
      <article class="panel"><h2>CHG-021 · معالجة مخالفة الفصل</h2><p>ابدأ من اختبار T-03 على FW-BASE. طبّق إجراءات التغيير في المحاكاة ثم اختبر FW-REV2 بشكل مستقل.</p>
      <ol class="workflow-steps">${stageNames.map((label,index) => `<li>${label}<small>${index < workflow.step || (index === 3 && fullVerification()) ? "تم" : index === workflow.step && saved["T-03"] ? "الخطوة الحالية" : "بانتظار الخطوة السابقة"}</small></li>`).join("")}</ol>
      <p class="footnote">الخطوات تمثل أدوار المؤسسة الافتراضية. المتدرب ينتقل بين الأدوار داخل المحاكاة.</p>
      <p class="run-actions">${saved["T-03"] ? workflow.step < 3 ? `<button id="change-next" class="primary" type="button">${["تسجيل الطلب بواسطة مالك الخدمة","اعتماد الطلب بواسطة مسؤول اعتماد التغيير","تسجيل التنفيذ بواسطة مهندس الشبكات"][workflow.step]}</button>` : '<a class="primary" href="#simulation/T-03/current">انتقل للتحقق المستقل ←</a>' : '<a class="primary" href="#simulation/T-03">شغّل اختبار المخالفة الأصلي ←</a>'}</p></article>
      <article class="panel"><h2>ملف الأدلة</h2><p>افتح كل سجل متاح، واختر ما يثبته قبل تسجيل قرار الإغلاق.</p>
      <div class="record-list">${WORKBENCH.evidence.map(([id,title,detail,key,proof]) => `<details class="record" ${evidenceReady(key) && !workflow.reviewed.includes(key) && key === "original" ? "open" : ""}><summary>${code(id)} · ${title} <small>${workflow.reviewed.includes(key) ? "تمت المراجعة" : evidenceReady(key) ? "متاح" : "بانتظار السجل"}</small></summary>
      ${evidenceReady(key) ? `<p>${detail}</p>${key === "original" ? `<p>${timeLabel(saved["T-03"].at)}</p>` : key === "retest" ? `<p>${timeLabel(currentResults["T-03"].at)}</p>` : workflow.times[key] ? `<p>${timeLabel(workflow.times[key])}</p>` : ""}
      <form class="risk-form proof-form" data-proof="${key}"><label>ما الذي يثبته هذا السجل؟<select name="proof" required><option value="">اختر</option>${Object.entries(evidenceTypes).map(([value,label])=>`<option value="${value}" ${workflow.reviewed.includes(key) && value===key ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="quiet" type="submit">راجع الإجابة</button><p role="status">${workflow.reviewed.includes(key) ? proof : ""}</p></form>` : '<p>يظهر السجل بعد تنفيذ الخطوة أو الاختبار المرتبط به.</p>'}</details>`).join("")}</div></article>
      ${renderWorkflowRaci()}
      <article class="panel"><h2>قرار متابعة المخالفة</h2><p>يتطلب إغلاق المخالفة هنا أدلة مفسرة، والتحقق من جميع المسارات المطلوبة على FW-REV2، وإكمال تمرين المسؤوليات. يُراجع قبول الخطر المتبقي ضمن التفويض حتى بعد إغلاق المخالفة.</p>
      <form id="workflow-decision" class="risk-form"><label>القرار<select name="decision" required><option value="">اختر</option><option value="open">إبقاء المخالفة مفتوحة</option><option value="escalate">تصعيد للمراجعة</option><option value="close">إغلاق المخالفة بعد التحقق</option></select></label>
      <label>مبرر القرار ومراجع الأدلة<textarea name="reason" required maxlength="1200" rows="3"></textarea></label><button class="primary">تسجيل القرار</button><p id="workflow-feedback" role="status"></p></form></article></div>`;
    select("#change-next")?.addEventListener("click", () => {
      const key = ["request","approval","revision"][workflow.step];
      workflow.times[key] = Date.now();
      workflow.step += 1;
      if (workflow.step === 3) verificationMode = true;
      persistWorkbench();
      renderWorkflow();
      renderScenario();
      renderScorecard();
      (select("#change-next") ?? select('#workflow-stage a[href="#simulation/T-03/current"]')).focus();
    });
    for (const form of target.querySelectorAll("[data-proof]")) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        const key = form.dataset.proof;
        const message = select('[role="status"]', form);
        if (form.elements.proof.value !== key) {
          message.textContent = "راجع مصدر السجل ونطاقه، ثم حدّد ما يثبته مباشرة.";
          return;
        }
        if (!workflow.reviewed.includes(key)) workflow.reviewed.push(key);
        persistWorkbench();
        select("summary small", form.closest("details")).textContent = "تمت المراجعة";
        message.textContent = WORKBENCH.evidence.find(row => row[3] === key)[4];
      });
    }
    bindWorkflowRaci();
    const decisionForm = select("#workflow-decision");
    decisionForm.elements.decision.value = workflow.decision?.value ?? "";
    decisionForm.elements.reason.value = workflow.decision?.reason ?? "";
    select("#workflow-feedback").textContent = workflow.decision ? "آخر قرار مسجل في هذه الجولة." : "";
    decisionForm.addEventListener("submit", event => {
      event.preventDefault();
      const {decision, reason} = Object.fromEntries(new FormData(decisionForm));
      const feedback = select("#workflow-feedback");
      if (!saved["T-03"]) { feedback.textContent = "شغّل T-03 لتسجيل المخالفة قبل اتخاذ قرار المتابعة."; return; }
      if (!reason.trim()) { feedback.textContent = "اكتب مبررًا مرتبطًا بالدليل."; return; }
      if (decision === "close" && !(fullVerification() && allEvidenceReviewed() && workflow.raciPassed)) {
        feedback.textContent = "الإغلاق غير متاح بعد. أكمل التحقق على FW-REV2 ومراجعة الأدلة وتمرين RACI.";
        return;
      }
      workflow.decision = {value:decision, reason:reason.trim(), at:Date.now()};
      feedback.textContent = persistWorkbench() ? "تم تسجيل القرار في هذه الجولة." : "سُجل القرار في الذاكرة لهذه الجلسة.";
      renderRiskStatus();
      refreshSubmissionEvidence();
    });
  }

  function renderWorkflowRaci() {
    const roles = GOVERNANCE.roles;
    const options = `<option value="">اختر</option>${Object.entries(roles).map(([id,label])=>`<option value="${id}">${label}</option>`).join("")}`;
    return `<article class="panel"><h2>تمرين RACI على دورة التغيير</h2><p>اختر ممثلًا لكل حرف في كل نشاط. قد يوجد أكثر من طرف للاستشارة أو الإبلاغ في المصفوفة المرجعية. في التمرين اختر واحدًا.</p>
    <form id="workflow-raci" class="risk-form">${table(["النشاط","R المنفّذ","A صاحب المساءلة","C يُستشار","I يُبلّغ"],WORKBENCH.activities.map(([id,title])=>[title,...["R","A","C","I"].map(letter=>`<select name="${id}-${letter}" aria-label="${title} · ${letter}" required>${options}</select>`)]))}
    <label>لماذا يملك هذا الدور حق قبول الخطر المتبقي؟<textarea name="authority" rows="3" required maxlength="1200"></textarea></label>
    <label>لو تجاوز الخطر حد التفويض، ما مسار القرار؟<select name="escalation" required><option value="">اختر</option><option value="engineer">مهندس التنفيذ يقبل الخطر</option><option value="committee">تصعيد إلى لجنة الحوكمة وفق التفويض</option><option value="audit">المراجعة الداخلية تقبل الخطر بدل مالكه</option></select></label>
    <button type="submit" class="primary">تحقق من مصفوفة الأدوار</button><div id="workflow-raci-feedback" role="status"></div></form></article>`;
  }

  function bindWorkflowRaci() {
    const form = select("#workflow-raci");
    for (const field of form.elements) {
      if (Object.hasOwn(workflow.raciAnswers,field.name)) field.value = workflow.raciAnswers[field.name];
    }
    const feedback = select("#workflow-raci-feedback");
    form.addEventListener("input", () => {
      workflow.raciAnswers = Object.fromEntries(new FormData(form));
      if (workflow.raciPassed) {
        workflow.raciPassed = false;
        if (workflow.decision?.value === "close") {
          workflow.decision = null;
          select("#workflow-feedback").textContent = "أعد التحقق من الأدوار قبل اعتماد الإغلاق.";
        }
        renderRiskStatus();
      }
      feedback.textContent = "تحقق من التوزيع بعد تعديل الإجابات.";
      persistWorkbench();
    });
    if (workflow.raciPassed) feedback.textContent = "توزيع الأدوار مجتاز. المبرر المكتوب متاح لمراجعة المدرّب.";
    form.addEventListener("submit", event => {
      event.preventDefault();
      const answers = Object.fromEntries(new FormData(form));
      const issues = [];
      for (const [id,title,responsible,accountable,consulted,informed] of WORKBENCH.activities) {
        const [r,a,c,i] = ["R","A","C","I"].map(letter => answers[id+"-"+letter]);
        if (new Set([r,a,c,i]).size !== 4 || r !== responsible || a !== accountable || !consulted.includes(c) || !informed.includes(i)) {
          issues.push(title + " — راجع المنفّذ وصاحب المساءلة ومن يُستشار أو يُبلّغ.");
        }
      }
      const implementationRoles = [answers["implement-R"],answers["implement-A"]];
      if (["verify-R","verify-A","close-A"].some(key=>implementationRoles.includes(answers[key]))) {
        issues.push("تعارض في فصل المهام: دور التنفيذ أو صاحب مساءلته لا ينفّذ التحقق المستقل ولا يعتمد نتيجته أو إغلاقها في هذا السيناريو.");
      }
      if (answers.escalation !== "committee" || !answers.authority.trim()) issues.push("حدّد صاحب سلطة قبول الخطر وحدود التفويض ومسار التصعيد.");
      workflow.raciAnswers = answers;
      workflow.raciPassed = issues.length === 0;
      if (issues.length && workflow.decision?.value === "close") workflow.decision = null;
      persistWorkbench();
      feedback.innerHTML = issues.length ? `<ul>${issues.map(issue=>`<li>${issue}</li>`).join("")}</ul>` : "<p>توزيع الأدوار مجتاز. راجع مبرر التفويض المكتوب مع المدرّب.</p>";
      if (issues.length && !workflow.decision) select("#workflow-feedback").textContent = "أعد مراجعة قرار الإغلاق بعد تصحيح المسؤوليات.";
      renderRiskStatus();
      refreshSubmissionEvidence();
    });
  }


  function renderPermissions() {
    const target = select("#permissions-stage");
    const cases = WORKBENCH.permissions;
    const count = cases.filter(([id]) => permissionResults[id]).length;
    const matched = cases.filter(([id, , , , expected, observed]) => permissionResults[id] && expected === observed).length;
    const roleNames = {app:"مسؤول التطبيق", owner:GOVERNANCE.roles.owner, ops:GOVERNANCE.roles.ops, sec:GOVERNANCE.roles.sec, lead:GOVERNANCE.roles.lead};
    target.innerHTML = `<div class="stack"><article class="panel"><h2>${reference("A.8.3")}</h2>
    <div class="facts">
    <div class="fact"><h3>النطاق والخطر</h3><p>ندى وعمر يصلان إلى التطبيق الداخلي عبر نفس مسار HTTPS من شبكة الموظفين. يتحقق التطبيق من صلاحية كل عملية على نفس السجل التدريبي REC-104. قد يؤدي منح صلاحية زائدة إلى تغيير غير معتمد، وقد يؤدي رفض صلاحية صحيحة إلى تعطيل العمل.</p></div>
    <div class="fact"><h3>السياسة · POL-APP-01</h3><p>المراجِع يعرض سجلات قسمه. المحرّر يعرضها ويعدلها. تُراجع الصلاحيات عند تغير الدور ويُرفض الإجراء الذي لا يملك المستخدم صلاحية له. تُطبق الصلاحيات على مستوى التطبيق والبيانات.</p></div>
    <div class="fact"><h3>الإجراء · PROC-APP-01</h3><p>وثّق نطاق السجلات والدور، واعتمد الطلب، وطبّق الصلاحيات، ثم اختبر العرض والتعديل لكل دور بحساب تدريبي. طابق قرار التطبيق مع السياسة، وسجل الدليل، وأعد الاختبار بعد أي معالجة.</p></div>
    <div class="fact"><h3>الأدلة</h3><p>مصفوفة الصلاحيات المعتمدة APP-MX-01، وسجل قرار التطبيق لكل عملية. سجل السماح للشبكة يثبت وصول الاتصال إلى التطبيق، ويُراجع قرار عرض السجل أو تعديله في سجل التطبيق.</p></div></div>
    ${table(["المستخدم التدريبي","الدور","عرض سجل القسم","تعديل سجل القسم"],[["ندى","مراجِعة السجلات","مسموح","مرفوض"],["عمر","محرّر السجلات","مسموح","مسموح"]])}</article>
    <article class="panel"><h2>محاكاة قرارات التطبيق</h2><p>اختر التوقع لكل عملية، ثم قارن القرار المرصود بمصفوفة الصلاحيات. كل العمليات تستخدم نفس الاتصال المعتمد.</p>
    <div class="facts">${cases.map(([id,user,role,action])=>`<form class="fact risk-form" data-permission="${id}"><h3>${code(id)} · ${user} · ${action}</h3><p>${role} · السجل ${code("REC-104")}</p><label>المتوقع وفق السياسة<select name="prediction" required><option value="">اختر</option><option value="allowed">سماح</option><option value="denied">منع</option></select></label><button class="quiet">شغّل اختبار الصلاحية</button><p data-permission-result="${id}" role="status"></p></form>`).join("")}</div></article>
    <article class="panel"><h2>سجل أدلة التطبيق</h2>${count ? table(["الحالة والسجل","العملية","المتوقع","المرصود","الحكم والوقت"],cases.filter(([id])=>permissionResults[id]).map(([id,user,,action,expected,observed,log])=>[`${code(id)} · ${code(log)}`,`${user} · ${action}`,names[expected],names[observed],`${expected===observed ? "مطابق" : "غير مطابق"} · ${timeLabel(permissionResults[id].at)}`])) : "<p>تظهر سجلات التطبيق بعد تشغيل الاختبارات.</p>"}</article>
    <article class="panel"><h2>RACI لضابط تقييد الوصول إلى المعلومات</h2>${table(["النشاط",...Object.values(roleNames)],WORKBENCH.permissionRaci.map(([title,r,a,c,i])=>[title,...Object.keys(roleNames).map(role=>role===r ? "R" : role===a ? "A" : c.includes(role) ? "C" : i.includes(role) ? "I" : "—")]))}</article>
    <article class="panel"><h2>مؤشرات صلاحيات التطبيق</h2><div class="scorecards">
    <div class="metric"><h3>مطابقة القرارات</h3><strong>${count ? Math.round(100*matched/count)+"%" : "—"}</strong><p>${matched} مطابقة من ${count} اختبار منفذ.</p></div>
    <div class="metric"><h3>تغطية الاختبارات</h3><strong>${Math.round(100*count/cases.length)}%</strong><p>${count} من ${cases.length} اختبارات مطلوبة.</p></div></div>
    <p>المصدر: سجل قرارات التطبيق. المالك: مدير الأمن. المراجعة: بعد كل جولة أو تغيير صلاحيات. الهدف التدريبي لكل مؤشر 100%. عند المخالفة، يراجع مسؤول التطبيق إعداد الدور ويعيد الأمن الاختبار.</p>
    ${matched<count ? '<p class="notice">رُصد قرار مخالف للسياسة. راجع IA-04 وأثبت المعالجة بدليل جديد قبل إغلاق الملاحظة.</p>' : ""}</article></div>`;
    for (const permissionForm of target.querySelectorAll("[data-permission]")) {
      const id = permissionForm.dataset.permission;
      const record = permissionResults[id];
      const [, , , ,expected,observed,log] = cases.find(row=>row[0]===id);
      if (record) {
        permissionForm.elements.prediction.value = record.prediction;
        select("[data-permission-result]",permissionForm).textContent = `التطبيق: ${names[observed]} · ${log} · ${record.prediction===expected ? "توقعك مطابق للسياسة" : "المتوقع وفق السياسة: "+names[expected]}`;
      }
      permissionForm.addEventListener("submit",event=>{
        event.preventDefault();
        permissionResults[id] = {prediction:permissionForm.elements.prediction.value,at:Date.now()};
        persistWorkbench();
        renderPermissions();
        select(`[data-permission="${id}"] button`).focus();
        refreshSubmissionEvidence();
      });
    }
  }

  function evidenceOptions() {
    const network = LAB.scenarios.flatMap(scenario => {
      const {id} = scenario;
      return [[saved,false],[currentResults,true]].flatMap(([records,revised]) => {
        if (!records[id]) return [];
        const evaluated = activeScenario(scenario,revised);
        const revision = revised ? "FW-REV2" : "FW-BASE";
        const log = revised ? currentLogId(id) : GOVERNANCE.testDetails[id].log;
        const summary = `${revised ? currentTestId(id) : id} · ${revision} · ${log ?? "لا يوجد سجل قرار"}`;
        const detail = `${summary} · ${GOVERNANCE.testDetails[id].rule} · المتوقع: ${names[scenario.expected]} · المرصود: ${names[evaluated.observed]} · ${timeLabel(records[id].at)} · ${evaluated.evidence}`;
        return [[revision+"/"+id,summary,detail]];
      });
    });
    const change = WORKBENCH.evidence.filter(([, , ,key])=>evidenceReady(key) && ["request","approval","revision"].includes(key))
      .map(([id,title,detail,key])=>[id,`${id} · ${title}`,`${id} · ${title} · ${timeLabel(workflow.times[key])} · ${detail}`]);
    const application = WORKBENCH.permissions.filter(([id])=>permissionResults[id])
      .map(([id,user,,action,expected,observed,log])=>[id,`${id} · ${log} · ${user} · ${action}`,
        `${id} · ${log} · ${user} · ${action} · المتوقع: ${names[expected]} · المرصود: ${names[observed]} · ${timeLabel(permissionResults[id].at)}`]);
    return [...network,...change,...application];
  }

  function refreshSubmissionEvidence() {
    const target = select("#submission-evidence");
    if (!target) return;
    const checked = new Set([...target.querySelectorAll('input:checked')].map(input=>input.value));
    const options = evidenceOptions();
    target.replaceChildren(...options.map(([id,label])=>{
      const item = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "evidence";
      input.value = id;
      input.checked = checked.has(id);
      item.append(input," "+label);
      return item;
    }));
    if (!options.length) target.textContent = "شغّل اختبارًا أو سجّل خطوة تغيير لإتاحة مراجع الأدلة.";
  }

  function renderSubmission() {
    select("#submission-stage").innerHTML = `<div class="stack"><article class="panel"><h2>ملف تسليم الفريق</h2><p>اكتب خلاصة قابلة للمراجعة عبر المحاور الستة، وحدّد الأدلة التي تدعم قرارك. احفظ مسودة أثناء العمل، ثم نزّل نسخة عند اكتمالها.</p>
    <form id="course-submission" class="risk-form"><label>اسم الفريق<input name="team" maxlength="100" required></label>
    <div class="facts">${WORKBENCH.submission.map(([key,title,hint])=>`<label>${title}<small class="cell-detail">${hint}</small><textarea name="${key}" rows="3" maxlength="1800" required></textarea></label>`).join("")}</div>
    <fieldset><legend>الأدلة المرتبطة بالتسليم</legend><div id="submission-evidence" class="proof-options"></div></fieldset>
    <div class="run-actions"><button class="quiet" id="save-submission" type="button">حفظ المسودة</button><button class="primary" type="submit">تنزيل ملف التسليم</button><p id="submission-feedback" role="status"></p></div></form></article></div>`;
    const form = select("#course-submission");
    for (const key of ["team",...WORKBENCH.submission.map(([key])=>key)]) form.elements[key].value = submissionDraft[key] ?? "";
    refreshSubmissionEvidence();
    for (const input of form.querySelectorAll("[name=evidence]")) input.checked = submissionDraft.evidence?.includes(input.value) ?? false;
    function saveSubmission() {
      const fields = new FormData(form);
      submissionDraft = {...Object.fromEntries(fields),evidence:fields.getAll("evidence")};
      return persistWorkbench();
    }
    select("#save-submission").addEventListener("click",()=>{
      select("#submission-feedback").textContent = saveSubmission() ? "حُفظت المسودة في هذا المتصفح." : "تعذّر حفظ المسودة في المتصفح.";
    });
    form.addEventListener("submit",event=>{
      event.preventDefault();
      saveSubmission();
      if (!submissionDraft.evidence.length || ["team",...WORKBENCH.submission.map(([key])=>key)].some(key=>!submissionDraft[key].trim())) {
        select("#submission-feedback").textContent = "أكمل الحقول المطلوبة واختر مرجع دليل واحدًا على الأقل.";
        return;
      }
      const availableEvidence = new Map(evidenceOptions().map(([id,,detail])=>[id,detail]));
      const lines = ["# ملف تسليم معمل حوكمة الشبكة", "", "الفريق: "+submissionDraft.team.trim(), "",
        ...WORKBENCH.submission.flatMap(([key,title])=>["## "+title,submissionDraft[key].trim(),""]),
        "## الأدلة المختارة",...submissionDraft.evidence.map(id=>"- "+(availableEvidence.get(id) ?? id)), "",
        "## حالة المعمل عند التصدير",
        "- FW-REV2: "+(fullVerification() ? "نجحت جميع الاختبارات المطلوبة في نطاق المعمل" : "التحقق من الإصدار غير مكتمل"),
        "- قرار متابعة المخالفة: "+({open:"مفتوحة",escalate:"مُصعّدة",close:"مغلقة بعد التحقق"}[workflow.decision?.value] ?? "لم يُسجل"),
        ...(workflow.decision ? ["- مبرر القرار: "+workflow.decision.reason] : []),
        ...(workflow.raciPassed ? ["- مبرر قبول الخطر للمراجعة: "+workflow.raciAnswers.authority] : []),
        "","المراجعة العلمية والتوجيه التدريبي: المهندسة سارة فتحي الرفاعي."
      ];
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([lines.join("\n")+"\n"],{type:"text/markdown;charset=utf-8"}));
      link.download = "network-governance-lab-submission.md";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(link.href),1000);
      select("#submission-feedback").textContent = "تم تجهيز ملف التسليم للتنزيل.";
    });
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
    <div class="run-actions followup"><span class="tag" id="revision-in-use"></span><label>إصدار الإعداد <select id="revision-select"><option value="baseline">FW-BASE</option><option value="current">FW-REV2</option></select></label><a id="simulation-workflow" href="#workflow">ملف التغيير والتحقق ←</a></div>`;
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
  select("#revision-select").addEventListener("change",event=>{
    verificationMode = event.target.value === "current" && workflow.step === 3;
    renderScenario();
    location.hash = `simulation/${selectedScenario.id}/${verificationMode ? "current" : "base"}`;
  });
  select("#reset").addEventListener("click", () => {
    stopAnimation();
    for (const id of Object.keys(saved)) delete saved[id];
    for (const id of Object.keys(currentResults)) delete currentResults[id];
    Object.assign(workflow,emptyWorkflow());
    verificationMode = false;
    persistWorkbench();
    renderWorkflow();
    refreshSubmissionEvidence();
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
  renderWorkflow();
  renderPermissions();
  renderSubmission();
  renderScorecard();
  renderPage();
})();
