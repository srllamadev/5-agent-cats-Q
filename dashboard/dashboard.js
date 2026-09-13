let dashboardData = null;
let executiveReport = null;

async function loadData() {
    const params = new URLSearchParams(window.location.search);
    const auditId = params.get("audit_id");

    if (auditId) {
        try {
            const [dashResp, reportResp] = await Promise.all([
                fetch(`../output/${auditId}_dashboard.json`),
                fetch(`../output/${auditId}_report.json`),
            ]);
            dashboardData = await dashResp.json();
            const fullReport = await reportResp.json();
            executiveReport = fullReport.executive_report;
        } catch (e) {
            console.error("Error loading report:", e);
            loadSampleData();
        }
    } else {
        loadSampleData();
    }

    render();
}

function loadSampleData() {
    dashboardData = {
        kpis: { security_score: 72, hallazgos_criticos: 1, hallazgos_altos: 2, hallazgos_medios: 3, hallazgos_bajos: 1 },
        grafico_matriz_riesgo: [
            { hallazgo_id: "F-001", x: 4, y: 5 },
            { hallazgo_id: "F-002", x: 3, y: 4 },
            { hallazgo_id: "F-003", x: 2, y: 3 },
        ],
        grafico_cumplimiento_nist: {
            identify: ["Asset management", "Risk assessment"],
            protect: ["Access control", "Security training"],
            detect: ["Anomaly detection"],
            respond: ["Response planning"],
            recover: ["Recovery planning"],
        },
        tabla_hallazgos: [
            { id: "F-001", titulo: "Reentrancy", severidad: "critico", probabilidad: 4, impacto: 5, riesgo_nivel: "critico", poc_confirmado: true, control_iso27001: "A.9.1", funcion_nist: "protect" },
            { id: "F-002", titulo: "Access Control", severidad: "alto", probabilidad: 3, impacto: 4, riesgo_nivel: "alto", poc_confirmado: false, control_iso27001: "A.9.1", funcion_nist: "protect" },
            { id: "F-003", titulo: "Oracle Manipulation", severidad: "medio", probabilidad: 2, impacto: 3, riesgo_nivel: "medio", poc_confirmado: false, control_iso27001: "A.12.1", funcion_nist: "detect" },
        ],
    };
    executiveReport = {
        resumen_ejecutivo: "Auditoría de ejemplo. Security Score: 72/100 (con riesgos moderados). Se encontraron 7 hallazgos.",
        security_score: 72,
    };
}

function render() {
    renderKPIs();
    renderRiskMatrix();
    renderNISTChart();
    renderFindingsTable();
    renderSummary();
}

function renderKPIs() {
    const grid = document.getElementById("kpiGrid");
    const kpis = dashboardData.kpis;

    const scoreClass = kpis.security_score >= 80 ? "score-good" : kpis.security_score >= 50 ? "score-warn" : "score-bad";

    grid.innerHTML = `
        <div class="kpi-card">
            <span class="value ${scoreClass}">${kpis.security_score}</span>
            <span class="label">Security Score</span>
        </div>
        <div class="kpi-card">
            <span class="value critico">${kpis.hallazgos_criticos}</span>
            <span class="label">Críticos</span>
        </div>
        <div class="kpi-card">
            <span class="value alto">${kpis.hallazgos_altos}</span>
            <span class="label">Altos</span>
        </div>
        <div class="kpi-card">
            <span class="value medio">${kpis.hallazgos_medios}</span>
            <span class="label">Medios</span>
        </div>
        <div class="kpi-card">
            <span class="value bajo">${kpis.hallazgos_bajos}</span>
            <span class="label">Bajos</span>
        </div>
    `;
}

function renderRiskMatrix() {
    const canvas = document.getElementById("riskMatrix");
    const ctx = canvas.getContext("2d");
    const data = dashboardData.grafico_matriz_riesgo || [];

    const padding = 60;
    const cellSize = (canvas.width - padding * 2) / 5;

    ctx.fillStyle = "#0f1923";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colors = {
        bajo: "#2ecc7144",
        medio: "#f1c40f44",
        alto: "#e67e2244",
        critico: "#e74c3c44",
    };

    for (let p = 1; p <= 5; p++) {
        for (let i = 1; i <= 5; i++) {
            const score = p * i;
            let level = "bajo";
            if (score >= 16) level = "critico";
            else if (score >= 10) level = "alto";
            else if (score >= 5) level = "medio";

            const x = padding + (p - 1) * cellSize;
            const y = canvas.height - padding - i * cellSize;

            ctx.fillStyle = colors[level];
            ctx.fillRect(x, y, cellSize, cellSize);
            ctx.strokeStyle = "#2a3a4a";
            ctx.strokeRect(x, y, cellSize, cellSize);
        }
    }

    ctx.fillStyle = "#8899aa";
    ctx.font = "12px Segoe UI";
    ctx.textAlign = "center";
    for (let i = 1; i <= 5; i++) {
        ctx.fillText(i.toString(), padding + (i - 0.5) * cellSize, canvas.height - padding + 20);
    }
    ctx.textAlign = "right";
    for (let i = 1; i <= 5; i++) {
        ctx.fillText(i.toString(), padding - 10, canvas.height - padding - (i - 0.5) * cellSize + 4);
    }

    ctx.fillStyle = "#a8dadc";
    ctx.font = "13px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Probabilidad", canvas.width / 2, canvas.height - 10);
    ctx.save();
    ctx.translate(15, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Impacto", 0, 0);
    ctx.restore();

    data.forEach((point) => {
        if (point.x && point.y) {
            const px = padding + (point.x - 0.5) * cellSize;
            const py = canvas.height - padding - (point.y - 0.5) * cellSize;

            ctx.beginPath();
            ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fillStyle = "#e63946";
            ctx.fill();
            ctx.strokeStyle = "#f1faee";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "#f1faee";
            ctx.font = "10px Segoe UI";
            ctx.textAlign = "center";
            ctx.fillText(point.hallazgo_id, px, py - 14);
        }
    });
}

function renderNISTChart() {
    const canvas = document.getElementById("nistChart");
    const ctx = canvas.getContext("2d");
    const data = dashboardData.grafico_cumplimiento_nist || {};

    const functions = ["identify", "protect", "detect", "respond", "recover"];
    const colors = ["#3498db", "#2ecc71", "#f1c40f", "#e67e22", "#e74c3c"];

    ctx.fillStyle = "#0f1923";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 140;
    const angleStep = (Math.PI * 2) / functions.length;

    functions.forEach((func, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;

        ctx.beginPath();
        ctx.arc(x, y, 35, 0, Math.PI * 2);
        ctx.fillStyle = colors[i] + "33";
        ctx.fill();
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = colors[i];
        ctx.font = "bold 11px Segoe UI";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(func.toUpperCase(), x, y);

        const items = data[func] || [];
        if (items.length > 0) {
            ctx.fillStyle = "#8899aa";
            ctx.font = "9px Segoe UI";
            ctx.fillText(`${items.length} controles`, x, y + 16);
        }
    });

    functions.forEach((_, i) => {
        const angle1 = i * angleStep - Math.PI / 2;
        const angle2 = ((i + 1) % functions.length) * angleStep - Math.PI / 2;
        const x1 = centerX + Math.cos(angle1) * radius;
        const y1 = centerY + Math.sin(angle1) * radius;
        const x2 = centerX + Math.cos(angle2) * radius;
        const y2 = centerY + Math.sin(angle2) * radius;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = "#2a3a4a";
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

function renderFindingsTable() {
    const tbody = document.getElementById("findingsBody");
    const findings = dashboardData.tabla_hallazgos || [];

    tbody.innerHTML = findings
        .map((f) => {
            const sevClass = `severity-${f.severidad}`;
            const pocClass = f.poc_confirmado ? "poc-yes" : "poc-no";
            const pocText = f.poc_confirmado ? "SI" : "No";

            return `<tr>
                <td>${f.id}</td>
                <td>${f.titulo}</td>
                <td><span class="severity-badge ${sevClass}">${f.severidad}</span></td>
                <td>${f.probabilidad ?? "-"}</td>
                <td>${f.impacto ?? "-"}</td>
                <td><span class="${f.riesgo_nivel}">${f.riesgo_nivel}</span></td>
                <td><span class="${pocClass}">${pocText}</span></td>
                <td>${f.control_iso27001 || "-"}</td>
                <td>${f.funcion_nist || "-"}</td>
            </tr>`;
        })
        .join("");
}

function renderSummary() {
    const box = document.getElementById("executiveSummary");
    if (executiveReport) {
        box.textContent = executiveReport.resumen_ejecutivo || "Sin resumen disponible.";
    }
}

document.addEventListener("DOMContentLoaded", loadData);
