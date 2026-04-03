import { BrowserRouter as Router, Routes, Route, NavLink, useNavigate } from "react-router-dom";
import "./App.css";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────
const SAMPLE_DATA = {
  metrics: {
    total_cases: 120,
    average_cycle_time_hours: 7.4,
    cycle_time_std_dev: 3.2,
    average_stage_durations_hours: { APPROVAL: 2.8, PAYMENT: 8.9, REFUND_COMPLETED: 1.9 },
    bottleneck_stage: "PAYMENT",
    sla_breaches: { APPROVAL: 18, PAYMENT: 31, REFUND_COMPLETED: 4 },
    actor_performance_avg_hours: { "Finance Manager": 1.8, "AP Officer": 6.4, "CFO": 2.1, "AR Team": 0.9 },
    financial_metrics: {
      total_value_processed: 28500000,
      average_invoice_value: 237500,
      median_invoice_value: 198000,
      min_invoice_value: 42000,
      max_invoice_value: 1250000,
      invoice_value_std_dev: 185000,
    },
    cases: [
      { id: "2001", amount: 185000, actor: "AP Officer", totalHours: 9.2, breached: true, stages: [{ action: "APPROVAL", dur: 2.1 }, { action: "PAYMENT", dur: 7.1 }] },
      { id: "2002", amount: 420000, actor: "CFO", totalHours: 11.8, breached: true, stages: [{ action: "APPROVAL", dur: 3.4 }, { action: "PAYMENT", dur: 8.4 }] },
      { id: "2003", amount: 62000, actor: "Finance Manager", totalHours: 3.1, breached: false, stages: [{ action: "APPROVAL", dur: 1.2 }, { action: "PAYMENT", dur: 1.9 }] },
      { id: "2004", amount: 310000, actor: "AP Officer", totalHours: 14.2, breached: true, stages: [{ action: "APPROVAL", dur: 4.8 }, { action: "PAYMENT", dur: 9.4 }] },
      { id: "2005", amount: 95000, actor: "AR Team", totalHours: 2.8, breached: false, stages: [{ action: "APPROVAL", dur: 1.1 }, { action: "PAYMENT", dur: 1.7 }] },
      { id: "2006", amount: 540000, actor: "AP Officer", totalHours: 13.5, breached: true, stages: [{ action: "APPROVAL", dur: 4.1 }, { action: "PAYMENT", dur: 9.4 }] },
      { id: "2007", amount: 78000, actor: "Finance Manager", totalHours: 4.2, breached: false, stages: [{ action: "APPROVAL", dur: 1.8 }, { action: "PAYMENT", dur: 2.4 }] },
      { id: "2008", amount: 890000, actor: "CFO", totalHours: 16.1, breached: true, stages: [{ action: "APPROVAL", dur: 5.2 }, { action: "PAYMENT", dur: 10.9 }] },
    ],
  },
  efficiency_score: 41,
  ai_insights: {
    risks: [
      "PAYMENT stage averages 8.9h — 2.2× over the 4h SLA — directly responsible for ₹4.1L of monthly cash-flow delay.",
      "44% of invoices breach SLA at least once, indicating a systemic failure, not isolated incidents.",
      "AP Officer handles 74 of 120 invoices — 2.4× the load of any other actor, creating a single point of failure.",
    ],
    bottlenecks: [
      "PAYMENT stage alone accounts for 68% of total cycle time and 58% of all SLA breaches this month.",
      "CFO approval required for all invoices above ₹3L regardless of vendor history — no threshold tiering exists.",
    ],
    sla_suggestions: [
      "Introduce automated payment reminders at 3h and 3h45m post-approval to reduce PAYMENT stage breaches.",
      "Implement vendor trust tiers — pre-approved vendors with clean history skip manual re-verification.",
      "Set approval SLA alerts at 1.5h to allow escalation before the 2h limit is reached.",
    ],
    staffing: [
      "Hire one additional AP Officer to split the current 74-invoice load — projected to cut PAYMENT bottleneck by ~40%.",
      "Assign a dedicated CFO deputy with delegated authority up to ₹5L to unblock high-value invoice queue.",
    ],
  },
  baseline_costs: {
    labor_cost: 532800,
    sla_breach_cost: 265000,
    cash_flow_opportunity_cost: 49700,
    total_monthly_cost: 847500,
    cost_per_case: 7063,
  },
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:8000";
// Mirror of SLA_RULES in main.py — hours per stage
const SLA_RULES = { APPROVAL: 2, PAYMENT: 4, REFUND_COMPLETED: 6 };

const STORAGE_KEY = "flowlens_data";
const CHAT_KEY = "flowlens_chat";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = (n) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr`
    : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L`
      : n >= 1e3 ? `₹${(n / 1e3).toFixed(0)}K`
        : `₹${Math.round(n)}`;

function loadPersisted(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
function savePersisted(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { }
}

// ─── INSIGHT META ─────────────────────────────────────────────────────────────
const INSIGHT_META = {
  risks: { label: "Operational Risks", icon: "⚠️", color: "var(--red)", bg: "var(--red-dim)" },
  bottlenecks: { label: "Bottlenecks", icon: "🔴", color: "var(--amber)", bg: "var(--amber-dim)" },
  sla_suggestions: { label: "SLA Improvements", icon: "📋", color: "var(--blue-bright)", bg: "var(--blue-dim)" },
  staffing: { label: "Staffing Recommendations", icon: "👥", color: "var(--green)", bg: "var(--green-dim)" },
};

// ─── SHARED CONTEXT BUILDER ───────────────────────────────────────────────────
// Builds the process context string sent to all LLM endpoints (SOP + Copilot).
function buildProcessContext(data) {
  if (!data) return "No process data uploaded yet.";
  const m = data.metrics;
  // Build a human-readable stage list with SLA info
  const stageDurations = m.average_stage_durations_hours || {};
  const slaBreaches = m.sla_breaches || {};
  const stageLines = Object.entries(stageDurations)
    .map(([stage, dur]) => `  - ${stage}: avg ${dur}h, SLA limit ${SLA_RULES[stage] || "?"}h, breaches ${slaBreaches[stage] || 0}`)
    .join("\n");
  const actorLines = Object.entries(m.actor_performance_avg_hours || {})
    .map(([actor, hrs]) => `  - ${actor}: ${hrs}h avg response`)
    .join("\n");
  return `
Process: Invoice workflow
Total invoices processed: ${m.total_cases}
Average cycle time: ${m.average_cycle_time_hours}h (±${m.cycle_time_std_dev}h)
Bottleneck stage: ${m.bottleneck_stage} at ${stageDurations[m.bottleneck_stage]}h avg

Process Stages (with SLA rules and breach counts):
${stageLines}

Actors and their average response times:
${actorLines}

Financial data:
- Total value processed: ₹${m.financial_metrics?.total_value_processed?.toLocaleString()}
- Average invoice value: ₹${m.financial_metrics?.average_invoice_value?.toLocaleString()}
- Monthly process cost: ₹${data.baseline_costs?.total_monthly_cost?.toLocaleString()}
- Cost per case: ₹${data.baseline_costs?.cost_per_case?.toLocaleString()}

AI-identified risks: ${data.ai_insights?.risks?.join("; ")}
AI-identified bottlenecks: ${data.ai_insights?.bottlenecks?.join("; ")}
SLA improvement suggestions: ${data.ai_insights?.sla_suggestions?.join("; ")}
Staffing recommendations: ${data.ai_insights?.staffing?.join("; ")}
  `.trim();
}

// Safely convert any SOP field value to a human-readable string.
// Handles cases where the LLM returns an object instead of a plain string.
function safe(val) {
  if (val === null || val === undefined) return "";
  if (typeof val !== "object") return String(val);
  if (Array.isArray(val)) return val.map(safe).join(", ");
  // Object: "Key: value" pairs
  return Object.entries(val)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");
}

function polarToCartesian(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function describeArc(cx, cy, r, start, end) {
  const s = polarToCartesian(cx, cy, r, end);
  const e = polarToCartesian(cx, cy, r, start);
  const la = end - start <= 180 ? "0" : "1";
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${la} 0 ${e.x} ${e.y}`;
}

function EfficiencyGauge({ score }) {
  const r = 62, stroke = 10, nr = r - stroke / 2;
  const color = score >= 80 ? "var(--green)" : score >= 60 ? "var(--amber)" : "var(--red)";
  const label = score >= 80 ? "Efficient" : score >= 60 ? "Moderate" : "Critical";
  return (
    <div className="gauge-wrap">
      <div className="kpi-label" style={{ marginBottom: 10 }}>
        EFFICIENCY SCORE
        <span title="Score 0–100 based on SLA breach rate, cycle time vs target, and bottleneck severity." style={{ cursor: "help", marginLeft: 5, fontSize: 11, opacity: 0.6 }}>❓</span>
      </div>
      <svg height={r + 20} width={r * 2}>
        <path d={describeArc(r, r, nr, 180, 360)} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={describeArc(r, r, nr, 180, 180 + (score / 100) * 180)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        <text x={r} y={r + 4} textAnchor="middle" fontSize="24" fontWeight="700" fill={color} fontFamily="Sora, sans-serif">{score}</text>
        <text x={r} y={r + 18} textAnchor="middle" fontSize="10" fill="var(--text-3)" fontFamily="Sora, sans-serif">{label}</text>
      </svg>
    </div>
  );
}

// ─── GPU BENCHMARK ────────────────────────────────────────────────────────────
// GPUBenchmark merged into InferencePanel below
function GPUBenchmark() { return null; }

// ─── IMPLEMENTATION PLAN MODAL ────────────────────────────────────────────────
function ImplementationModal({ scenario, result, metrics, onClose }) {
  const savings = result?.predicted?.monthly_savings_net ?? 0;
  const annualSv = result?.predicted?.annual_savings_net ?? savings * 12;
  const cycleCut = result?.improvements?.cycle_time_reduction_pct ?? 0;
  const slaCut = result?.improvements?.sla_breach_reduction ?? 0;

  const planMap = {
    add_approver: {
      title: "Add Approver — Implementation Plan",
      phases: [
        {
          title: "Discovery & Role Design", timeline: "Week 1–2",
          steps: [
            { icon: "📋", text: "Define approval authority levels and invoice threshold matrix.", owner: "Ops Manager" },
            { icon: "📋", text: `Audit Priya's current queue — map peak load hours and approval patterns.`, owner: "Process Lead" },
            { icon: "📋", text: "Draft job description for secondary approver; determine internal vs external hire.", owner: "HR" },
          ],
        },
        {
          title: "Onboarding & System Setup", timeline: "Week 3–4",
          steps: [
            { icon: "⚙️", text: "Configure approval routing rules in the workflow system to distribute load.", owner: "IT/Ops" },
            { icon: "📘", text: "Shadow current approver for 5 business days; document edge-case decisions.", owner: "New Approver" },
            { icon: "📊", text: "Set up individual SLA tracking dashboards per approver for accountability.", owner: "IT" },
          ],
        },
        {
          title: "Go-Live & Measurement", timeline: "Week 5–8",
          steps: [
            { icon: "🚀", text: "Enable parallel routing. Monitor daily approval queue depth for first two weeks.", owner: "Ops Manager" },
            { icon: "📈", text: `Target: reduce PAYMENT SLA breaches to ≤${Math.max(0, (metrics?.sla_breaches?.PAYMENT || 11) - slaCut)} per month.`, owner: "Ops Manager" },
            { icon: "💰", text: `Track monthly savings against ₹${(savings / 1000).toFixed(0)}K/month target. Review at 30 and 60 days.`, owner: "Finance" },
          ],
        },
      ],
    },
    auto_approve: {
      title: "Auto-Approval — Implementation Plan",
      phases: [
        {
          title: "Rule Design & Risk Assessment", timeline: "Week 1–2",
          steps: [
            { icon: "📋", text: "Define auto-approval criteria: invoice threshold, vendor trust tier, invoice history.", owner: "Finance + Ops" },
            { icon: "🔒", text: "Identify exclusion list: first-time vendors, disputed accounts, amounts >₹1L.", owner: "Risk / Finance" },
            { icon: "📋", text: "Document approval audit trail requirements for compliance and future audit.", owner: "Compliance" },
          ],
        },
        {
          title: "System Build & Testing", timeline: "Week 3–5",
          steps: [
            { icon: "⚙️", text: "Build rules engine with configurable threshold parameters; connect to invoice system.", owner: "IT" },
            { icon: "🧪", text: "Dry-run on last 30 days of historical invoices — validate auto-approval accuracy rate.", owner: "IT + Finance" },
            { icon: "📧", text: "Set up instant notification to approver when auto-approval fires for anomaly review.", owner: "IT" },
          ],
        },
        {
          title: "Rollout & Optimisation", timeline: "Week 6–8",
          steps: [
            { icon: "🚀", text: `Launch with conservative threshold. Expand gradually based on error rate (target <1%).`, owner: "Ops Manager" },
            { icon: "📈", text: `Expected: ~${result?.improvements?.pct_auto_approved ?? 30}% of invoices auto-processed, cutting approval queue significantly.`, owner: "Ops Manager" },
            { icon: "💰", text: `Monthly savings target: ${fmt(savings)}. Break-even expected within ${result?.improvements?.payback_months ?? 6} months.`, owner: "Finance" },
          ],
        },
      ],
    },
    optimize_routing: {
      title: "Smart Routing — Implementation Plan",
      phases: [
        {
          title: "Routing Logic Design", timeline: "Week 1",
          steps: [
            { icon: "📋", text: "Map current manual routing decisions — who gets assigned what and why.", owner: "Ops Manager" },
            { icon: "📊", text: "Analyse actor availability patterns vs. invoice arrival times to find mismatches.", owner: "Process Lead" },
            { icon: "📋", text: "Define routing priority rules: urgency tier, invoice value, actor specialisation.", owner: "Ops Manager" },
          ],
        },
        {
          title: "System Implementation", timeline: "Week 2–3",
          steps: [
            { icon: "⚙️", text: "Configure SaaS routing tool with priority and availability rules.", owner: "IT" },
            { icon: "📱", text: "Enable actor availability status so routing engine skips unavailable approvers.", owner: "IT" },
            { icon: "⚙️", text: "Integrate escalation rules: auto-escalate to backup if no response within 1.5h.", owner: "IT" },
          ],
        },
        {
          title: "Go-Live & Tuning", timeline: "Week 4–6",
          steps: [
            { icon: "🚀", text: "Go live with routing engine. Track queue depth and first-response times daily.", owner: "Ops Manager" },
            { icon: "📈", text: `Target: cut average cycle time by ${cycleCut}% from current ${metrics?.average_cycle_time_hours ?? 0}h baseline.`, owner: "Ops Manager" },
            { icon: "💰", text: `Net savings after tool cost: ${fmt(savings)}/month. Fully realised by month 2.`, owner: "Finance" },
          ],
        },
      ],
    },
    custom: {
      title: "Custom Optimisation — Implementation Plan",
      phases: [
        {
          title: "Baseline Measurement", timeline: "Week 1–2",
          steps: [
            { icon: "📊", text: "Document current process in full detail — every handoff, every wait point.", owner: "Process Lead" },
            { icon: "📋", text: "Quantify each inefficiency with time and cost data for business case.", owner: "Finance + Ops" },
            { icon: "🎯", text: `Set concrete KPI targets aligned with ${cycleCut}% improvement goal.`, owner: "Ops Manager" },
          ],
        },
        {
          title: "Intervention Design", timeline: "Week 3–4",
          steps: [
            { icon: "⚙️", text: "Select specific interventions (staffing, automation, routing) for each bottleneck.", owner: "Ops Manager" },
            { icon: "📋", text: "Build change management plan — communicate changes to all actors in advance.", owner: "HR + Ops" },
            { icon: "🧪", text: "Pilot one intervention at a time to isolate impact and measure cleanly.", owner: "Process Lead" },
          ],
        },
        {
          title: "Rollout & Review", timeline: "Week 5–8",
          steps: [
            { icon: "🚀", text: "Deploy interventions in priority order — highest ROI first.", owner: "Ops Manager" },
            { icon: "📈", text: `Monthly review against ${fmt(savings)} savings target and ${cycleCut}% cycle time target.`, owner: "Finance" },
            { icon: "🔁", text: "Iterate: if target not met by month 2, escalate to next intervention.", owner: "Ops Manager" },
          ],
        },
      ],
    },
  };

  const plan = planMap[scenario] ?? planMap["custom"];

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">📋 {plan.title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {savings > 0 && (
            <div className="roi-summary">
              <div>
                <div className="roi-item-label">Monthly Savings</div>
                <div className="roi-item-val">{fmt(savings)}</div>
              </div>
              <div>
                <div className="roi-item-label">Annual Savings</div>
                <div className="roi-item-val">{fmt(annualSv)}</div>
              </div>
              <div>
                <div className="roi-item-label">Cycle Reduction</div>
                <div className="roi-item-val">{cycleCut}%</div>
              </div>
            </div>
          )}
          {plan.phases.map((phase, pi) => (
            <div className="impl-phase" key={pi}>
              <div className="impl-phase-header">
                <div className="impl-phase-number">{pi + 1}</div>
                <div className="impl-phase-title">{phase.title}</div>
                <div className="impl-phase-timeline">{phase.timeline}</div>
              </div>
              {phase.steps.map((step, si) => (
                <div className="impl-step" key={si}>
                  <div className="impl-step-icon">{step.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div>{step.text}</div>
                    <div className="impl-step-owner">Owner: {step.owner}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EXPORT ANALYSIS ─────────────────────────────────────────────────────────
async function exportSimulationPDF(scenario, result, metrics, baseline) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), m = 20, cW = W - m * 2;
  let y = 0;
  const nl = (n = 8) => { if (y + n > 272) { doc.addPage(); y = 20; } };

  doc.setFillColor(26, 58, 92);
  doc.rect(0, 0, W, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("FlowLens AI — Simulation Analysis Report", m, 14);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Scenario: ${scenario.replace(/_/g, " ").toUpperCase()}  |  ${new Date().toLocaleDateString("en-IN")}`, m, 22);
  doc.text(`Generated by FlowLens AI · Process Intelligence Platform`, m, 29);
  y = 46;
  doc.setTextColor(0, 0, 0);

  const sec = (t) => {
    nl(12);
    doc.setFillColor(234, 241, 248);
    doc.rect(m, y, cW, 8, "F");
    doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.setTextColor(26, 58, 92);
    doc.text(t, m + 3, y + 5.5);
    doc.setTextColor(0, 0, 0);
    y += 12;
  };

  const row = (l, v, color) => {
    nl(8);
    doc.setFontSize(9.5); doc.setFont("helvetica", "bold");
    doc.text(`${l}:`, m + 2, y);
    doc.setFont("helvetica", "normal");
    if (color) doc.setTextColor(...color);
    doc.text(String(v), m + 70, y);
    doc.setTextColor(0, 0, 0);
    y += 7;
  };

  sec("1. Baseline vs. Predicted Outcomes");
  row("Baseline Cycle Time", `${metrics?.average_cycle_time_hours ?? "—"} hours`);
  row("Predicted Cycle Time", `${result?.predicted?.cycle_time ?? "—"} hours`, [26, 107, 60]);
  row("Cycle Time Reduction", `${result?.improvements?.cycle_time_reduction_pct ?? 0}%`, [26, 107, 60]);
  row("Baseline SLA Breaches", `${result?.baseline?.sla_breaches ?? "—"} cases`);
  row("Predicted SLA Breaches", `${result?.predicted?.sla_breaches ?? "—"} cases`, [26, 107, 60]);
  row("SLA Breach Reduction", `${result?.improvements?.sla_breach_reduction ?? 0} fewer cases`, [26, 107, 60]);
  y += 4;

  sec("2. Financial Impact");
  const savings = result?.predicted?.monthly_savings_net ?? 0;
  row("Current Monthly Cost", `₹${(baseline?.total_monthly_cost || 0).toLocaleString("en-IN")}`);
  row("Monthly Savings (Net)", `₹${savings.toLocaleString("en-IN")}`, [26, 107, 60]);
  row("Annual Savings (Net)", `₹${(savings * 12).toLocaleString("en-IN")}`, [26, 107, 60]);
  if (result?.improvements?.payback_months) {
    row("Payback Period", `${result.improvements.payback_months} months`);
  }
  y += 4;

  if (result?.recommendations?.length) {
    sec("3. Recommendations");
    result.recommendations.forEach((r, i) => {
      nl(10);
      const lines = doc.splitTextToSize(`${i + 1}. ${r}`, cW - 4);
      doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
      doc.text(lines, m + 2, y);
      y += lines.length * 5.5 + 3;
    });
    y += 4;
  }

  sec("4. Process Context");
  row("Total Cases Analysed", metrics?.total_cases ?? "—");
  row("Bottleneck Stage", metrics?.bottleneck_stage?.replace(/_/g, " ") ?? "—");
  row("Average Invoice Value", metrics?.financial_metrics?.average_invoice_value
    ? `₹${metrics.financial_metrics.average_invoice_value.toLocaleString("en-IN")}` : "—");
  row("Total Value Processed", metrics?.financial_metrics?.total_value_processed
    ? `₹${metrics.financial_metrics.total_value_processed.toLocaleString("en-IN")}` : "—");

  const tp = doc.internal.getNumberOfPages();
  for (let p = 1; p <= tp; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5); doc.setTextColor(160, 160, 160);
    doc.text(`FlowLens AI Process Intelligence  ·  Confidential  ·  Page ${p} of ${tp}`, m, 290);
  }
  doc.save(`FlowLens_SimAnalysis_${scenario}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── PROCESS FLOW ─────────────────────────────────────────────────────────────
function ProcessFlow({ metrics }) {
  const stages = Object.entries(metrics?.average_stage_durations_hours || {});
  if (!stages.length) return null;
  const bot = metrics.bottleneck_stage;
  return (
    <div className="card mb-4 fade-up delay-3">
      <div className="section-hd">
        <span className="section-title">PROCESS FLOW</span>
        <span className="badge badge-red">Bottleneck: {bot?.replace(/_/g, " ")}</span>
      </div>
      <div className="flow-wrap">
        {stages.map(([stage, dur], i) => {
          const isBot = stage === bot;
          return (
            <div key={stage} style={{ display: "flex", alignItems: "center" }}>
              <div className={`flow-node ${isBot ? "bottleneck" : "normal"}`}>
                <div className="flow-node-label">{stage.replace(/_/g, " ")}</div>
                <div className="flow-node-dur">{dur}</div>
                <div className="flow-node-unit">hrs avg</div>
                {isBot && <div className="flow-node-flag">⚠ BOTTLENECK</div>}
              </div>
              {i < stages.length - 1 && <div style={{ width: 16, textAlign: "center", color: "var(--border-dark)", fontSize: 11 }}>→</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FINANCIAL STRIP ──────────────────────────────────────────────────────────
function FinancialStrip({ data }) {
  const fin = data?.metrics?.financial_metrics;
  const costs = data?.baseline_costs;
  if (!fin) return null;
  const items = [
    { label: "TOTAL PROCESSED", value: fmt(fin.total_value_processed) },
    { label: "AVG INVOICE", value: fmt(fin.average_invoice_value) },
    { label: "MEDIAN INVOICE", value: fmt(fin.median_invoice_value) },
    { label: "LARGEST INVOICE", value: fmt(fin.max_invoice_value) },
    { label: "MONTHLY LABOR", value: fmt(costs?.labor_cost || 0) },
    { label: "SLA PENALTIES", value: fmt(costs?.sla_breach_cost || 0) },
    { label: "TOTAL MONTHLY COST", value: fmt(costs?.total_monthly_cost || 0) },
    { label: "COST PER CASE", value: fmt(costs?.cost_per_case || 0) },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      {data?.metrics?.gpu_accelerated && (
        <div className="fade-up delay-3" style={{ marginBottom: 16, padding: "12px 16px", background: "var(--green-dim)", border: "1px solid rgba(16,185,129,.2)", borderRadius: "var(--radius-md)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: data?.metrics?.stage_correlation_matrix ? 12 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--green)" }}>⚡ GPU-Accelerated Correlation Analysis</div>
            <span className="badge badge-green" style={{ fontSize: 10 }}>ROCm Accelerated</span>
          </div>
          {data?.metrics?.stage_correlation_matrix && (() => {
            const mat = data.metrics.stage_correlation_matrix;
            const stages = Object.keys(mat);
            return (
              <div style={{ overflowX: "auto" }}>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 6 }}>Pearson correlation between stage durations — shows which stages move together</div>
                <table style={{ borderCollapse: "collapse", fontSize: 10.5, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "4px 8px", color: "var(--text-3)", textAlign: "left", fontWeight: 600 }}>Stage</th>
                      {stages.map(s => <th key={s} style={{ padding: "4px 8px", color: "var(--text-3)", fontWeight: 600, textAlign: "center" }}>{s.replace(/_/g, " ")}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map(row => (
                      <tr key={row}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "var(--text-2)", whiteSpace: "nowrap" }}>{row.replace(/_/g, " ")}</td>
                        {stages.map(col => {
                          const val = mat[row]?.[col] ?? 0;
                          const abs = Math.abs(val);
                          const bg = val > 0.5 ? `rgba(16,185,129,${abs * 0.4})` : val < -0.3 ? `rgba(239,68,68,${abs * 0.4})` : "transparent";
                          return <td key={col} style={{ padding: "4px 8px", textAlign: "center", fontFamily: "var(--mono)", background: bg, borderRadius: 3, color: "var(--text-1)" }}>{val.toFixed ? val.toFixed(2) : "—"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 6, display: "flex", gap: 12, fontSize: 9.5, color: "var(--text-3)" }}>
                  <span><span style={{ color: "var(--green)", fontWeight: 700 }}>■</span> Positive correlation (&gt;0.5)</span>
                  <span><span style={{ color: "var(--red)", fontWeight: 700 }}>■</span> Negative correlation (&lt;-0.3)</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      <div className="fin-grid fade-up delay-4">
        {items.map(item => (
          <div key={item.label} className="fin-card">
            <div className="fin-label">{item.label}</div>
            <div className="fin-value">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── STAGE CHART ──────────────────────────────────────────────────────────────
function StageDurationChart({ metrics }) {
  if (!metrics) return null;
  const bot = metrics.bottleneck_stage;
  const data = Object.entries(metrics.average_stage_durations_hours || {}).map(([s, d]) => ({
    stage: s.replace(/_/g, " "), duration: d, isBot: s === bot,
  }));
  if (!data.length) return null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 11px", fontSize: 12 }}>
        <div style={{ color: "var(--text-1)", fontWeight: 600 }}>{payload[0].payload.stage}</div>
        <div style={{ color: "var(--text-3)", marginTop: 2 }}>{payload[0].value} hrs avg</div>
      </div>
    );
  };

  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="section-hd"><span className="section-title">STAGE DURATION</span></div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-3)" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="stage" tick={{ fontSize: 10, fill: "var(--text-3)" }} width={115} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Bar dataKey="duration" radius={[0, 3, 3, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.isBot ? "var(--red)" : "var(--blue)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {[["var(--blue)", "Normal"], ["var(--red)", "Bottleneck"]].map(([c, l]) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-3)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── ACTOR TABLE ──────────────────────────────────────────────────────────────
function ActorTable({ metrics }) {
  const [sortDir, setSortDir] = useState("desc");
  const actors = Object.entries(metrics?.actor_performance_avg_hours || {});
  if (!metrics || !actors.length) return null;
  const max = Math.max(...actors.map(([, v]) => v));
  const sorted = [...actors].sort((a, b) => sortDir === "desc" ? b[1] - a[1] : a[1] - b[1]);

  const getStatus = (pct) =>
    pct >= 80 ? { label: "Heavy Load", cls: "badge-red" }
      : pct >= 50 ? { label: "Moderate", cls: "badge-amber" }
        : { label: "Good", cls: "badge-green" };

  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="section-hd">
        <span className="section-title">ACTOR PERFORMANCE</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}>
          {sortDir === "desc" ? "↑ Slowest first" : "↓ Fastest first"}
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Actor</th><th>Avg Response</th><th>Load</th><th>Status</th></tr>
        </thead>
        <tbody>
          {sorted.map(([actor, avg]) => {
            const pct = Math.round((avg / max) * 100);
            const st = getStatus(pct);
            const bc = pct >= 80 ? "var(--red)" : pct >= 50 ? "var(--amber)" : "var(--green)";
            return (
              <tr key={actor}>
                <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{actor}</td>
                <td style={{ fontFamily: "var(--mono)", color: "var(--text-2)" }}>{avg} hrs</td>
                <td style={{ width: 120 }}>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: bc }} />
                  </div>
                </td>
                <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── CASE DRILL-DOWN ─────────────────────────────────────────────────────────
function CaseDrilldown({ metrics }) {
  const [expanded, setExpanded] = useState(null);
  const [sortKey, setSortKey] = useState("totalHours");
  const [sortDir, setSortDir] = useState("desc");

  const cases = metrics?.cases;
  if (!cases?.length) return null;

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = [...cases].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  const SortTh = ({ label, k }) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: "pointer", userSelect: "none" }}>
      {label} {sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div className="card fade-up delay-5" style={{ marginTop: 16 }}>
      <div className="section-hd">
        <span className="section-title">INVOICE CASE LOG</span>
        <span className="badge badge-blue">{cases.length} cases</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <SortTh label="Amount" k="amount" />
            <th>Actor</th>
            <SortTh label="Total Time" k="totalHours" />
            <th>SLA Status</th>
            <th style={{ width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <>
              <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                <td style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--text-1)" }}>#{c.id}</td>
                <td style={{ fontFamily: "var(--mono)" }}>{fmt(c.amount)}</td>
                <td>{c.actor}</td>
                <td style={{ fontFamily: "var(--mono)" }}>{c.totalHours.toFixed(1)} hrs</td>
                <td>
                  <span className={`badge ${c.breached ? "badge-red" : "badge-green"}`}>
                    {c.breached ? "SLA Breach" : "On Track"}
                  </span>
                </td>
                <td style={{ color: "var(--text-3)", fontSize: 10, textAlign: "center" }}>
                  {expanded === c.id ? "▲" : "▼"}
                </td>
              </tr>
              {expanded === c.id && (
                <tr key={`${c.id}-exp`}>
                  <td colSpan={6} style={{ padding: 0, background: "var(--surface-2)" }}>
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Stage Timeline — Invoice #{c.id}
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
                        {c.stages.map((s, i) => {
                          const slaLimit = SLA_RULES[s.action] ?? 999;
                          const isBreach = s.dur > slaLimit;
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 100 }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                                <div style={{
                                  padding: "6px 10px", borderRadius: 4, textAlign: "center", minWidth: 88,
                                  background: isBreach ? "var(--red-dim)" : "var(--blue-dim)",
                                  border: `1px solid ${isBreach ? "rgba(239,68,68,.2)" : "rgba(59,130,246,.2)"}`,
                                }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: isBreach ? "var(--red)" : "var(--blue-bright)", marginBottom: 2 }}>
                                    {s.action.replace(/_/g, " ")}
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--mono)" }}>
                                    {s.dur.toFixed(1)}h
                                  </div>
                                  <div style={{ fontSize: 9, color: "var(--text-3)" }}>
                                    SLA: {slaLimit}h {isBreach ? "⚠" : "✓"}
                                  </div>
                                </div>
                              </div>
                              {i < c.stages.length - 1 && (
                                <div style={{ width: 20, height: 1, background: "var(--border)", flexShrink: 0, marginBottom: 4 }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── PERFORMANCE BENCHMARK ────────────────────────────────────────────────────
function PerformanceBenchmark({ data, benchmarkData, hardwareInfo }) {
  const perf = data?.performance || benchmarkData;
  const mode = data?.inference_mode || "unknown";
  const isAMD = mode === "local_amd";
  const hw = data?.hardware || hardwareInfo;

  if (!perf && !hw) return null;

  const gpuAvailable = perf?.gpu_available ?? hw?.gpu_available ?? false;
  const gpuName = perf?.gpu_name || hw?.gpu_name || "CPU";
  const device = perf?.device || hw?.device || "cpu";
  const speedup = perf?.gpu_speedup;
  const tps = perf?.tokens_per_sec;
  const cpuBaseline = perf?.cpu_baseline_tps;
  const inferMs = perf?.inference_time_ms;
  const totalMs = perf?.total_time_ms;
  const model = perf?.model_used;
  const totalTok = perf?.total_tokens;

  const accent = isAMD ? "var(--green)" : "var(--blue-bright)";
  const bg = isAMD ? "var(--green-dim)" : "var(--blue-dim)";
  const border = isAMD ? "rgba(16,185,129,.2)" : "rgba(59,130,246,.2)";

  const Stat = ({ label, value, hilite, sub }) => (
    <div style={{ flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--mono)", color: hilite || "var(--text-1)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="card fade-up delay-1" style={{ background: bg, border: `1px solid ${border}`, marginBottom: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", color: accent, marginBottom: 3 }}>
            {isAMD ? "\u26a1 AMD Local Inference" : "\u2601\ufe0f Cloud Inference"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {gpuName}{model ? ` \u00b7 ${model}` : ""}{device && device !== gpuName ? ` \u00b7 ${device}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {isAMD && (
            <span className={`badge ${gpuAvailable ? "badge-green" : "badge-amber"}`} style={{ fontSize: 10 }}>
              {gpuAvailable ? "\u26a1 GPU Active" : "CPU-only"}
            </span>
          )}
          {!isAMD && <span className="badge badge-blue" style={{ fontSize: 10 }}>\u2601\ufe0f Gemini</span>}
        </div>
      </div>

      {/* ── GPU Speedup Hero (AMD + GPU only) ── */}
      {isAMD && gpuAvailable && speedup && (
        <div style={{
          background: "linear-gradient(135deg, rgba(16,185,129,.12), rgba(16,185,129,.04))",
          border: "1px solid rgba(16,185,129,.3)", borderRadius: 8,
          padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16,
        }}>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--green)", lineHeight: 1 }}>
            {speedup}x
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 3 }}>
              Faster than CPU baseline
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
              <span style={{ fontFamily: "var(--mono)", color: "var(--green)" }}>{tps} tok/s</span>
              {" "}on AMD GPU vs{" "}
              <span style={{ fontFamily: "var(--mono)" }}>~{cpuBaseline} tok/s</span>
              {" "}CPU-only \u2014 llama3.2:3b
            </div>
          </div>
          <div style={{ fontSize: 28, opacity: .7 }}>\ud83d\ude80</div>
        </div>
      )}

      {/* ── CPU-only warning ── */}
      {isAMD && !gpuAvailable && (
        <div style={{
          background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.2)",
          borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "var(--amber)",
        }}>
          Running CPU-only \u2014 no AMD GPU detected. Install ROCm drivers and restart{" "}
          <code style={{ fontFamily: "var(--mono)" }}>ollama serve</code> to enable GPU acceleration.
        </div>
      )}

      {/* ── Stats row ── */}
      {perf && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {inferMs != null && (
            <Stat label="Inference Time" value={`${(inferMs / 1000).toFixed(2)}s`} />
          )}
          {totalMs != null && Math.abs(totalMs - (inferMs || 0)) > 100 && (
            <Stat label="Total Time" value={`${(totalMs / 1000).toFixed(2)}s`} />
          )}
          {tps != null && (
            <Stat label="Tokens / sec" value={tps} hilite={isAMD && gpuAvailable ? "var(--green)" : undefined} />
          )}
          {totalTok != null && (
            <Stat label="Tokens Generated" value={totalTok} />
          )}
        </div>
      )}

      {/* ── No perf yet, just HW status ── */}
      {!perf && hw && (
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Hardware detected. Upload a log file to see live inference performance metrics.
        </div>
      )}
    </div>
  );
}

// ─── WHAT-IF SIMULATOR ────────────────────────────────────────────────────────
function WhatIfSimulator({ metrics, baselineCosts }) {
  const [scenario, setScenario] = useState("baseline");
  const [params, setParams] = useState({ additional_approvers: 1, auto_approval_threshold: 50, target_reduction: 20 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showCostConfig, setShowCostConfig] = useState(false);
  const [costConfig, setCostConfig] = useState({ hourly_labor_cost: 500, sla_breach_penalty: 5000, cost_of_capital_daily: 0.0005 });

  const baselineCycle = metrics?.average_cycle_time_hours ?? 0;
  const baselineSLA = Object.values(metrics?.sla_breaches || {}).reduce((a, b) => a + b, 0);

  const runSim = useCallback(async (scen, p) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scen, metrics, params: p, cost_config: costConfig }),
      });
      if (res.ok) { setResult(await res.json()); }
      else setResult(null);
    } catch {
      setResult(null);
    } finally { setLoading(false); }
  }, [metrics, costConfig]);

  useEffect(() => {
    if (scenario === "baseline") { setResult(null); return; }
    const t = setTimeout(() => runSim(scenario, params), 300);
    return () => clearTimeout(t);
  }, [scenario, params, runSim]);

  if (!metrics) return null;

  const scenarios = [
    { value: "baseline", label: "Current State", icon: "◎" },
    { value: "add_approver", label: "Add Approver", icon: "+" },
    { value: "auto_approve", label: "Auto-Approve", icon: "⚡" },
    { value: "optimize_routing", label: "Smart Routing", icon: "→" },
    { value: "custom", label: "Custom Target", icon: "⚙" },
  ];

  const p = result?.predicted || {};
  const im = result?.improvements || {};
  const newCycle = p.cycle_time ?? baselineCycle;
  const newSLA = p.sla_breaches ?? baselineSLA;
  const savings = p.monthly_savings_net ?? 0;

  const compData = [
    { name: "Cycle Time (h)", baseline: baselineCycle, predicted: +newCycle },
    { name: "SLA Breaches", baseline: baselineSLA, predicted: newSLA },
  ];

  return (
    <div className="card mb-4 fade-up delay-4">
      <div className="section-hd" style={{ marginBottom: 16 }}>
        <span className="section-title">
          WHAT-IF SIMULATOR
          <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400, marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
            Model process changes &amp; predict outcomes
          </span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && <span style={{ fontSize: 11, color: "var(--blue-bright)" }}>Running…</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCostConfig(c => !c)}>⚙ Cost Config</button>
        </div>
      </div>

      {showCostConfig && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-3)", marginBottom: 10 }}>Custom Cost Parameters</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { label: "Labor Cost (₹/hr)", key: "hourly_labor_cost", min: 100, max: 5000, step: 50 },
              { label: "SLA Penalty (₹/breach)", key: "sla_breach_penalty", min: 500, max: 50000, step: 500 },
              { label: "Capital Cost (%/day)", key: "cost_of_capital_daily", min: 0.0001, max: 0.005, step: 0.0001, display: v => (v * 100).toFixed(3) },
            ].map(({ label, key, min, max, step, display }) => (
              <div key={key}>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
                  {display ? display(costConfig[key]) + "%" : `₹${costConfig[key].toLocaleString()}`}
                </div>
                <input type="range" min={min} max={max} step={step} value={costConfig[key]}
                  style={{ width: "100%", accentColor: "var(--blue)" }}
                  onChange={e => setCostConfig(c => ({ ...c, [key]: parseFloat(e.target.value) }))} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 8 }}>
            Changes apply to all simulations via the backend's financial model.
          </div>
        </div>
      )}
      <div className="sim-scenarios">
        {scenarios.map(s => (
          <button key={s.value} className={`sim-btn ${scenario === s.value ? "active" : ""}`} onClick={() => setScenario(s.value)}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {scenario === "add_approver" && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600, display: "block", marginBottom: 7 }}>
            Additional Approvers: <span style={{ color: "var(--blue-bright)", fontFamily: "var(--mono)" }}>{params.additional_approvers}</span>
          </label>
          <input type="range" min="1" max="5" value={params.additional_approvers}
            onChange={e => setParams(p => ({ ...p, additional_approvers: +e.target.value }))} style={{ width: "100%" }} />
        </div>
      )}

      {scenario === "auto_approve" && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600, display: "block", marginBottom: 7 }}>
            Auto-Approve Threshold: <span style={{ color: "var(--blue-bright)", fontFamily: "var(--mono)" }}>₹{params.auto_approval_threshold}K</span>
          </label>
          <input type="range" min="10" max="200" step="10" value={params.auto_approval_threshold}
            onChange={e => setParams(p => ({ ...p, auto_approval_threshold: +e.target.value }))} style={{ width: "100%" }} />
        </div>
      )}

      {scenario === "custom" && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600, display: "block", marginBottom: 7 }}>
            Target Improvement: <span style={{ color: "var(--blue-bright)", fontFamily: "var(--mono)" }}>{params.target_reduction}%</span>
          </label>
          <input type="range" min="5" max="50" step="5" value={params.target_reduction}
            onChange={e => setParams(p => ({ ...p, target_reduction: +e.target.value }))} style={{ width: "100%" }} />
        </div>
      )}

      <div className="sim-results">
        <div className="sim-result">
          <div className="sim-result-label">AVG CYCLE TIME</div>
          <div className="sim-result-val">{(+newCycle).toFixed(1)}<span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-3)", marginLeft: 3 }}>h</span></div>
          {scenario !== "baseline" && im.cycle_time_reduction_pct > 0 && (
            <div className="sim-result-delta">↓ {im.cycle_time_reduction_pct}% faster</div>
          )}
        </div>
        <div className="sim-result">
          <div className="sim-result-label">SLA BREACHES</div>
          <div className="sim-result-val">{newSLA}<span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-3)", marginLeft: 3 }}>cases</span></div>
          {scenario !== "baseline" && im.sla_breach_reduction > 0 && (
            <div className="sim-result-delta">↓ {im.sla_breach_reduction} fewer</div>
          )}
        </div>
        <div className="sim-result">
          <div className="sim-result-label">MONTHLY SAVINGS</div>
          <div className="sim-result-val">{savings > 0 ? fmt(savings) : "—"}</div>
          {scenario !== "baseline" && savings > 0 && (
            <div className="sim-result-delta">Annual: {fmt(savings * 12)}</div>
          )}
        </div>
      </div>

      {scenario !== "baseline" && result && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-3)", marginBottom: 8 }}>
            BASELINE vs. PROJECTED
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={compData} margin={{ left: 0, right: 10, top: 4 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--text-3)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-3)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Legend wrapperStyle={{ fontSize: 10, color: "var(--text-3)" }} />
              <Bar dataKey="baseline" name="Baseline" fill="var(--surface-3)" radius={[3, 3, 0, 0]} barSize={28} />
              <Bar dataKey="predicted" name="Projected" fill="var(--blue)" radius={[3, 3, 0, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {result?.recommendations?.length > 0 && (
        <div style={{ borderLeft: "2px solid var(--blue)", paddingLeft: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 7 }}>
            RECOMMENDATIONS
          </div>
          {result.recommendations.map((r, i) => (
            <div key={i} style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 5, lineHeight: 1.55 }}>
              {i + 1}. {r}
            </div>
          ))}
        </div>
      )}

      {result?.calculation_details && (
        <div style={{ padding: "10px 14px", background: "var(--blue-tint)", borderRadius: "var(--radius-md)", border: "1px solid var(--blue-dim)", marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--blue)", marginBottom: 8 }}>
            Model: {result.calculation_details.model}
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {result.calculation_details.gross_savings != null && (
              <div><div style={{ fontSize: 9.5, color: "var(--text-3)", marginBottom: 2 }}>Gross Savings</div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--green)" }}>{fmt(result.calculation_details.gross_savings)}/mo</div></div>
            )}
            {(result.calculation_details.hiring_cost ?? result.calculation_details.implementation_cost_monthly ?? result.calculation_details.software_cost) != null && (
              <div><div style={{ fontSize: 9.5, color: "var(--text-3)", marginBottom: 2 }}>Implementation</div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--amber)" }}>{fmt(result.calculation_details.hiring_cost ?? result.calculation_details.implementation_cost_monthly ?? result.calculation_details.software_cost)}/mo</div></div>
            )}
            {result.calculation_details.net_savings != null && (
              <div><div style={{ fontSize: 9.5, color: "var(--text-3)", marginBottom: 2 }}>Net Savings</div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)" }}>{fmt(result.calculation_details.net_savings)}/mo</div></div>
            )}
          </div>
        </div>
      )}

      {scenario !== "baseline" && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowPlan(true)}>
            📋 Generate Implementation Plan
          </button>
          <button className="btn btn-secondary btn-sm"
            onClick={() => exportSimulationPDF(scenario, result, metrics, baselineCosts)}>
            📊 Export Analysis
          </button>
        </div>
      )}

      {showPlan && (
        <ImplementationModal
          scenario={scenario}
          result={result}
          metrics={metrics}
          onClose={() => setShowPlan(false)}
        />
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ data }) {
  const navigate = useNavigate();
  const metrics = data?.metrics;
  const score = data?.efficiency_score ?? null;

  if (!data) {
    return (
      <div>
        <div className="page-header fade-up">
          <div className="page-title">Operational Dashboard</div>
          <div className="page-sub">Upload a business chat log to start mining your process data</div>
        </div>
        <div className="empty-state fade-up delay-1">
          <div className="empty-icon">📊</div>
          <div className="empty-title">No data yet</div>
          <div className="empty-sub">Upload a business communication log to see process metrics, bottlenecks, financial costs, and AI insights.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={() => navigate("/upload")}>Upload a file →</button>
            <button className="btn btn-secondary" onClick={() => navigate("/upload")}>Try sample data</button>
          </div>
        </div>
      </div>
    );
  }

  const totalSLA = Object.values(metrics.sla_breaches || {}).reduce((a, b) => a + b, 0);
  const slaRate = ((totalSLA / metrics.total_cases) * 100).toFixed(0);

  return (
    <div>
      <div className="page-header fade-up">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">Operational Dashboard</div>
            <div className="page-sub">{metrics.total_cases} invoices · ±{metrics.cycle_time_std_dev}h std dev</div>
          </div>
          <span className={`badge ${score >= 80 ? "badge-green" : score >= 60 ? "badge-amber" : "badge-red"}`} style={{ fontSize: 11, padding: "4px 10px" }}>
            Efficiency: {score}/100
          </span>
        </div>
      </div>

      {/* Model attribution badge */}
      {data?.performance?.model_used && (
        <div className="fade-up" style={{ marginBottom: 14, padding: "8px 14px", background: "var(--blue-dim)", border: "1px solid rgba(59,130,246,.2)", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "var(--blue-bright)", fontWeight: 600 }}>Powered by {data.performance.model_used === "llama-3.3-70b-versatile" ? "Groq · Llama 3.3 70B" : data.performance.model_used}</span>
          {data.performance.inference_time_ms && <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{(data.performance.inference_time_ms / 1000).toFixed(2)}s inference</span>}
        </div>
      )}

      <div className="kpi-grid fade-up delay-1">
        <div className="kpi-card" style={{ "--kpi-color": "var(--blue)" }}>
          <div className="kpi-label">Total Cases</div>
          <div className="kpi-value">{metrics.total_cases}</div>
          <div className="kpi-sub">invoices processed</div>
        </div>
        <div className="kpi-card" style={{ "--kpi-color": "var(--amber)" }}>
          <div className="kpi-label">Avg Cycle Time</div>
          <div className="kpi-value">{metrics.average_cycle_time_hours}<span style={{ fontSize: 14, fontWeight: 400, marginLeft: 2 }}>h</span></div>
          <div className="kpi-sub">±{metrics.cycle_time_std_dev}h variance</div>
        </div>
        <div className="kpi-card" style={{ "--kpi-color": "var(--red)" }}>
          <div className="kpi-label">Bottleneck</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>{metrics.bottleneck_stage?.replace(/_/g, " ")}</div>
          <div className="kpi-sub">{metrics.average_stage_durations_hours?.[metrics.bottleneck_stage]}h avg</div>
        </div>
        <div className="kpi-card" style={{ "--kpi-color": totalSLA > 5 ? "var(--red)" : "var(--green)" }}>
          <div className="kpi-label">SLA Breaches</div>
          <div className="kpi-value">{totalSLA}</div>
          <div className="kpi-sub" style={{ color: totalSLA > 5 ? "var(--red)" : "var(--green)" }}>{slaRate}% breach rate</div>
        </div>
        <EfficiencyGauge score={score} />
      </div>

      <FinancialStrip data={data} />
      <ProcessFlow metrics={metrics} />
      <WhatIfSimulator metrics={metrics} baselineCosts={data.baseline_costs} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }} className="fade-up delay-5">
        <StageDurationChart metrics={metrics} />
        <ActorTable metrics={metrics} />
      </div>

      <CaseDrilldown metrics={metrics} />
    </div>
  );
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
const UPLOAD_STEPS = ["Parsing chat log", "Running process mining", "Computing financials", "Getting AI insights"];

function Upload({ setData }) {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const fileRef = useRef();

  const animateSteps = async () => {
    for (let i = 0; i < UPLOAD_STEPS.length; i++) {
      setSteps(UPLOAD_STEPS.map((s, j) => ({ label: s, state: j < i ? "done" : j === i ? "active" : "idle" })));
      await new Promise(r => setTimeout(r, 850));
    }
  };

  const resetUpload = () => {
    setFile(null); setStatus(null); setSteps([]); setLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const processFile = async (f) => {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = "";
    setFile(f); setStatus(null); setLoading(true);
    setSteps(UPLOAD_STEPS.map(s => ({ label: s, state: "idle" })));
    const fd = new FormData();
    fd.append("file", f);

    animateSteps();

    const doFetch = async (signal) => {
      const res = await fetch(`${API_BASE}/analyze`, { method: "POST", body: fd, signal });
      if (!res.ok) throw new Error("Backend error");
      return res.json();
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let data;
      try {
        data = await doFetch(controller.signal);
        clearTimeout(timeout);
      } catch (err) {
        clearTimeout(timeout);
        setStatus({ type: "info", message: "AI service busy. Retrying with fallback model..." });
        // Retry once with a new controller
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 30000);
        data = await doFetch(retryController.signal);
        clearTimeout(retryTimeout);
      }

      setSteps(UPLOAD_STEPS.map(s => ({ label: s, state: "done" })));
      savePersisted(STORAGE_KEY, data);
      setData(data);
      setStatus({ type: "success", message: `Analysis complete! Powered by ${data?.performance?.model_used || "AI"}. Redirecting…` });
      setTimeout(() => navigate("/dashboard"), 1200);
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus({ type: "error", message: "Request timed out again. Please try a smaller file." });
      } else {
        setStatus({ type: "error", message: "Cannot reach backend. AI service temporarily unavailable." });
      }
      setSteps([]);
      if (fileRef.current) fileRef.current.value = "";
    } finally { setLoading(false); }
  };

  const DEMO_LOG = `18/02/2026, 08:02 - Rahul: Good morning team! Sent invoice #1001 ₹45,000 to the client
18/02/2026, 08:15 - Priya: Got it Rahul, will review
18/02/2026, 08:45 - Priya: Approved invoice #1001, looks good
18/02/2026, 08:46 - Arjun: ok noted
18/02/2026, 09:10 - Rahul: Payment received #1001 ₹45,000 from client, confirming now
18/02/2026, 09:12 - Arjun: great
18/02/2026, 09:30 - Rahul: Sent invoice #1002 ₹125,000 to the new client
18/02/2026, 09:45 - Meena: who approved this one?
18/02/2026, 10:00 - Priya: Approved invoice #1002
18/02/2026, 10:05 - Meena: ok thanks
18/02/2026, 12:30 - Rahul: Payment received #1002 ₹125,000, client paid in full
18/02/2026, 12:35 - Arjun: 👍
18/02/2026, 13:00 - Rahul: Sent invoice #1003 ₹67,500
18/02/2026, 13:02 - Meena: Rahul did you send the right amount?
18/02/2026, 13:05 - Rahul: yes correct amount
18/02/2026, 13:10 - Meena: ok
18/02/2026, 15:30 - Priya: Approved invoice #1003, sorry for the delay was in a meeting
18/02/2026, 17:00 - Rahul: Payment received #1003 ₹67,500
18/02/2026, 17:05 - Priya: 👍
19/02/2026, 09:00 - Rahul: Sent invoice #1004 ₹285,000 to enterprise client
19/02/2026, 09:15 - Arjun: Priya can you check this one quickly
19/02/2026, 09:20 - Priya: on it
19/02/2026, 11:00 - Priya: Approved invoice #1004
19/02/2026, 11:05 - Rahul: thanks Priya
19/02/2026, 14:00 - Rahul: still waiting on payment #1004
19/02/2026, 14:30 - Arjun: client said they will pay by EOD
19/02/2026, 17:45 - Rahul: Payment received #1004 ₹285,000 finally
19/02/2026, 17:46 - Meena: phew
19/02/2026, 08:30 - Rahul: Sent invoice #1005 ₹52,000
19/02/2026, 08:32 - Arjun: Priya please approve asap this client is important
19/02/2026, 08:45 - Priya: Approved invoice #1005
19/02/2026, 09:00 - Rahul: Payment received #1005 ₹52,000 wow that was fast
19/02/2026, 09:01 - Meena: record time lol
19/02/2026, 09:02 - Arjun: good client
19/02/2026, 10:00 - Rahul: Sent invoice #1006 ₹38,000
19/02/2026, 10:05 - Meena: Priya you around?
19/02/2026, 10:10 - Priya: yeah whats up
19/02/2026, 10:11 - Meena: invoice #1006 needs approval
19/02/2026, 10:15 - Priya: Approved invoice #1006
19/02/2026, 13:00 - Rahul: Payment received #1006 ₹38,000
19/02/2026, 13:02 - Arjun: nice
19/02/2026, 14:30 - Rahul: Sent invoice #1007 ₹95,000 to the retail client
19/02/2026, 14:35 - Meena: is this the same one from last month?
19/02/2026, 14:37 - Rahul: yes recurring client
19/02/2026, 14:40 - Meena: ok got it
19/02/2026, 16:00 - Priya: Approved invoice #1007
19/02/2026, 19:30 - Rahul: Payment received #1007 ₹95,000 client paid after hours
19/02/2026, 19:32 - Arjun: at this hour??
19/02/2026, 19:33 - Rahul: haha yes
20/02/2026, 08:00 - Rahul: Sent invoice #1008 ₹71,000
20/02/2026, 08:05 - Arjun: morning all
20/02/2026, 09:30 - Priya: Approved invoice #1008
20/02/2026, 11:00 - Rahul: Payment received #1008 ₹71,000
20/02/2026, 11:02 - Meena: smooth one today
20/02/2026, 11:30 - Rahul: Sent invoice #1009 ₹43,500
20/02/2026, 11:45 - Priya: Approved invoice #1009 quickly since I'm here
20/02/2026, 13:00 - Rahul: Payment received #1009 ₹43,500
20/02/2026, 13:05 - Arjun: back to back, good day
20/02/2026, 14:00 - Rahul: Sent invoice #1010 ₹198,000 to overseas client
20/02/2026, 14:10 - Meena: overseas? so payment might take longer
20/02/2026, 14:15 - Rahul: yes probably
20/02/2026, 16:30 - Priya: Approved invoice #1010
20/02/2026, 20:00 - Rahul: Payment received #1010 ₹198,000 client wired it
20/02/2026, 20:05 - Arjun: 👍
21/02/2026, 08:15 - Rahul: Sent invoice #1011 ₹59,000
21/02/2026, 08:20 - Meena: already? busy morning
21/02/2026, 10:00 - Priya: Approved invoice #1011 sorry was on a call
21/02/2026, 12:30 - Rahul: Payment received #1011 ₹59,000
21/02/2026, 12:32 - Arjun: nice
21/02/2026, 13:00 - Rahul: Sent invoice #1012 ₹82,000
21/02/2026, 13:05 - Meena: Priya please check #1012 when you get a chance
21/02/2026, 14:30 - Priya: Approved invoice #1012
21/02/2026, 17:00 - Rahul: Payment received #1012 ₹82,000
21/02/2026, 17:02 - Meena: another one done
22/02/2026, 09:00 - Rahul: Sent invoice #1013 ₹35,000 to new startup client
22/02/2026, 09:10 - Arjun: startups sometimes delay payment just fyi
22/02/2026, 09:15 - Rahul: noted
22/02/2026, 10:00 - Priya: Approved invoice #1013
22/02/2026, 16:00 - Rahul: still no payment #1013
22/02/2026, 16:05 - Arjun: told you
22/02/2026, 16:10 - Meena: should we follow up?
22/02/2026, 16:12 - Rahul: yes calling them now
22/02/2026, 18:30 - Rahul: Payment received #1013 ₹35,000 after followup call
22/02/2026, 18:32 - Priya: good persistence
22/02/2026, 08:45 - Rahul: Sent invoice #1014 ₹116,000
22/02/2026, 09:00 - Priya: Approved invoice #1014
22/02/2026, 10:30 - Rahul: Payment received #1014 ₹116,000
22/02/2026, 10:32 - Arjun: clean process today
22/02/2026, 11:00 - Rahul: Sent invoice #1015 ₹48,500
22/02/2026, 11:30 - Priya: Approved invoice #1015
22/02/2026, 13:00 - Rahul: Payment received #1015 ₹48,500
22/02/2026, 13:05 - Meena: good rhythm today
22/02/2026, 14:00 - Rahul: Sent invoice #1016 ₹425,000 to the manufacturing client
22/02/2026, 14:05 - Arjun: big one?
22/02/2026, 14:07 - Rahul: yes largest this week
22/02/2026, 14:10 - Arjun: Priya please prioritize #1016
22/02/2026, 15:00 - Priya: Approved invoice #1016 done
22/02/2026, 18:00 - Rahul: Payment received #1016 ₹425,000 client paid same day
22/02/2026, 18:02 - Arjun: excellent
22/02/2026, 18:03 - Meena: that client is great
23/02/2026, 08:00 - Rahul: Sent invoice #1017 ₹63,000
23/02/2026, 08:30 - Priya: Approved invoice #1017
23/02/2026, 10:00 - Rahul: Payment received #1017 ₹63,000
23/02/2026, 10:05 - Meena: smooth
23/02/2026, 10:30 - Rahul: Sent invoice #1018 ₹89,000
23/02/2026, 11:00 - Priya: Approved invoice #1018
23/02/2026, 13:30 - Rahul: Payment received #1018 ₹89,000
23/02/2026, 13:35 - Arjun: good day so far
23/02/2026, 14:30 - Rahul: Sent invoice #1019 ₹54,000
23/02/2026, 15:00 - Priya: Approved invoice #1019
23/02/2026, 17:00 - Rahul: Payment received #1019 ₹54,000
23/02/2026, 17:05 - Meena: three in one day!
23/02/2026, 17:06 - Arjun: new record?
23/02/2026, 17:08 - Rahul: haha maybe
24/02/2026, 09:00 - Rahul: Sent invoice #1020 ₹135,000 to logistics client
24/02/2026, 09:10 - Meena: Priya are you in today?
24/02/2026, 09:15 - Priya: yes just late, Approved invoice #1020
24/02/2026, 11:00 - Rahul: Payment received #1020 ₹135,000
24/02/2026, 11:05 - Arjun: nice
24/02/2026, 12:00 - Rahul: Sent invoice #1021 ₹76,000
24/02/2026, 13:30 - Priya: Approved invoice #1021 after lunch
24/02/2026, 15:30 - Rahul: Payment received #1021 ₹76,000
24/02/2026, 15:35 - Meena: consistent today
24/02/2026, 16:00 - Rahul: Sent invoice #1022 ₹41,000
24/02/2026, 16:30 - Priya: Approved invoice #1022
24/02/2026, 18:30 - Rahul: Payment received #1022 ₹41,000
24/02/2026, 18:32 - Arjun: wrapping up nicely
25/02/2026, 08:30 - Rahul: Sent invoice #1023 ₹92,000
25/02/2026, 09:00 - Priya: Approved invoice #1023
25/02/2026, 10:30 - Rahul: Payment received #1023 ₹92,000
25/02/2026, 10:35 - Meena: good morning everyone lol catching up
25/02/2026, 11:00 - Rahul: Sent invoice #1024 ₹168,000 to healthcare client
25/02/2026, 11:05 - Arjun: healthcare clients always pay on time
25/02/2026, 11:30 - Priya: Approved invoice #1024
25/02/2026, 12:30 - Rahul: Payment received #1024 ₹168,000 as expected
25/02/2026, 12:32 - Arjun: called it
25/02/2026, 13:30 - Rahul: Sent invoice #1025 ₹55,000
25/02/2026, 14:00 - Priya: Approved invoice #1025
25/02/2026, 16:00 - Rahul: Payment received #1025 ₹55,000
25/02/2026, 16:05 - Meena: end of week strong
25/02/2026, 16:06 - Arjun: great week team
25/02/2026, 16:08 - Priya: 👍
26/02/2026, 09:00 - Rahul: Sent invoice #1026 ₹215,000 to tech client
26/02/2026, 09:15 - Priya: Approved invoice #1026
26/02/2026, 10:00 - Rahul: Payment received #1026 ₹215,000
26/02/2026, 10:02 - Meena: tech clients are quick
26/02/2026, 10:30 - Rahul: Sent invoice #1027 ₹73,000
26/02/2026, 11:00 - Priya: Approved invoice #1027
26/02/2026, 13:00 - Rahul: Payment received #1027 ₹73,000
26/02/2026, 13:05 - Arjun: good
26/02/2026, 14:00 - Rahul: Sent invoice #1028 ₹28,000 refund case
26/02/2026, 14:05 - Meena: refund? what happened
26/02/2026, 14:08 - Rahul: client overpaid last month
26/02/2026, 14:10 - Meena: ah ok
26/02/2026, 15:00 - Priya: Approved invoice #1028
26/02/2026, 15:05 - Arjun: Rahul initiate the refund once approved
26/02/2026, 15:10 - Rahul: Refund initiated #1028 ₹28,000
26/02/2026, 17:00 - Rahul: Refund completed #1028 ₹28,000 client confirmed
26/02/2026, 17:02 - Priya: good handling
26/02/2026, 17:30 - Rahul: Sent invoice #1029 ₹104,000
26/02/2026, 18:00 - Priya: Approved invoice #1029
26/02/2026, 20:00 - Rahul: Payment received #1029 ₹104,000 client paid after hours again
26/02/2026, 20:05 - Arjun: these clients dont sleep
27/02/2026, 08:00 - Rahul: Sent invoice #1030 ₹61,000
27/02/2026, 08:30 - Priya: Approved invoice #1030 early bird
27/02/2026, 09:30 - Rahul: Payment received #1030 ₹61,000
27/02/2026, 09:32 - Meena: wow quick
27/02/2026, 10:00 - Rahul: Sent invoice #1031 ₹145,000
27/02/2026, 10:30 - Priya: Approved invoice #1031
27/02/2026, 12:00 - Rahul: Payment received #1031 ₹145,000
27/02/2026, 12:02 - Arjun: smooth operations today
27/02/2026, 13:00 - Rahul: Sent invoice #1032 ₹178,000 to media client
27/02/2026, 13:10 - Meena: Priya this one has special terms check the notes
27/02/2026, 13:15 - Priya: ok checking
27/02/2026, 14:30 - Priya: Approved invoice #1032 checked the terms all good
27/02/2026, 17:30 - Rahul: Payment received #1032 ₹178,000
27/02/2026, 17:32 - Arjun: good
27/02/2026, 18:00 - Rahul: Sent invoice #1033 ₹85,000
27/02/2026, 18:30 - Priya: Approved invoice #1033
27/02/2026, 21:00 - Rahul: Payment received #1033 ₹85,000 late payment came in
27/02/2026, 21:02 - Meena: you're still working at 9pm??
27/02/2026, 21:03 - Rahul: haha monitoring payments
28/02/2026, 08:15 - Rahul: Sent invoice #1034 ₹96,000
28/02/2026, 08:45 - Priya: Approved invoice #1034
28/02/2026, 10:00 - Rahul: Payment received #1034 ₹96,000
28/02/2026, 10:05 - Arjun: solid
28/02/2026, 10:30 - Rahul: Sent invoice #1035 ₹320,000 to government client
28/02/2026, 10:35 - Meena: government clients take forever
28/02/2026, 10:40 - Arjun: true usually 30 days
28/02/2026, 11:00 - Priya: Approved invoice #1035
28/02/2026, 17:00 - Rahul: no payment yet on #1035 as expected
28/02/2026, 17:05 - Meena: told you
28/02/2026, 17:10 - Arjun: its fine its government SLA is different
28/02/2026, 19:00 - Rahul: Payment received #1035 ₹320,000 surprisingly fast for government
28/02/2026, 19:02 - Meena: wow shocked
28/02/2026, 19:03 - Arjun: nice exception
01/03/2026, 09:00 - Rahul: Sent invoice #1036 ₹68,000
01/03/2026, 09:30 - Priya: Approved invoice #1036
01/03/2026, 11:00 - Rahul: Payment received #1036 ₹68,000
01/03/2026, 11:02 - Arjun: 👍
01/03/2026, 12:00 - Rahul: Sent invoice #1037 ₹152,000 to education client
01/03/2026, 12:05 - Meena: education sector is usually slow too
01/03/2026, 13:00 - Priya: Approved invoice #1037
01/03/2026, 15:30 - Rahul: Payment received #1037 ₹152,000 faster than expected
01/03/2026, 15:32 - Meena: nice surprise
01/03/2026, 16:00 - Rahul: Sent invoice #1038 ₹79,000
01/03/2026, 16:30 - Priya: Approved invoice #1038
01/03/2026, 18:00 - Rahul: Payment received #1038 ₹79,000
01/03/2026, 18:02 - Arjun: good end to the month
01/03/2026, 18:30 - Rahul: Sent invoice #1039 ₹113,000
01/03/2026, 19:00 - Priya: Approved invoice #1039
01/03/2026, 21:30 - Rahul: Payment received #1039 ₹113,000 last one of the month
01/03/2026, 21:32 - Meena: great month team!
01/03/2026, 21:33 - Arjun: well done everyone
01/03/2026, 21:35 - Priya: proud of us 👏
01/03/2026, 08:00 - Rahul: New month! Sent invoice #1040 ₹84,000
01/03/2026, 08:10 - Arjun: fresh start
01/03/2026, 08:30 - Priya: Approved invoice #1040
01/03/2026, 09:30 - Rahul: Payment received #1040 ₹84,000
01/03/2026, 09:32 - Meena: quick start to March
01/03/2026, 10:00 - Rahul: Sent invoice #1041 ₹57,000
01/03/2026, 10:15 - Priya: Approved invoice #1041
01/03/2026, 11:30 - Rahul: Payment received #1041 ₹57,000
01/03/2026, 11:35 - Arjun: consistent
01/03/2026, 13:00 - Rahul: Sent invoice #1042 ₹245,000 to fintech client
01/03/2026, 13:05 - Meena: fintech clients are usually very prompt
01/03/2026, 13:30 - Priya: Approved invoice #1042
01/03/2026, 14:00 - Rahul: Payment received #1042 ₹245,000 as expected very fast
01/03/2026, 14:02 - Meena: called it
01/03/2026, 14:30 - Rahul: Sent invoice #1043 ₹91,000
01/03/2026, 15:00 - Priya: Approved invoice #1043
01/03/2026, 17:00 - Rahul: Payment received #1043 ₹91,000
01/03/2026, 17:05 - Arjun: good first day of March
02/03/2026, 09:00 - Rahul: Sent invoice #1044 ₹102,000
02/03/2026, 09:30 - Priya: Approved invoice #1044
02/03/2026, 11:00 - Rahul: Payment received #1044 ₹102,000
02/03/2026, 11:02 - Meena: nice
02/03/2026, 11:30 - Rahul: Sent invoice #1045 ₹42,000 refund case from last quarter
02/03/2026, 11:35 - Arjun: another refund?
02/03/2026, 11:38 - Rahul: yes billing error from our side
02/03/2026, 11:40 - Arjun: ah ok we need to fix that process
02/03/2026, 12:00 - Priya: Approved invoice #1045
02/03/2026, 12:10 - Rahul: Refund initiated #1045 ₹42,000
02/03/2026, 14:00 - Rahul: Refund completed #1045 ₹42,000 client happy
02/03/2026, 14:02 - Priya: good resolution
02/03/2026, 14:05 - Arjun: Meena can you look into why billing errors are happening
02/03/2026, 14:08 - Meena: on it will check the records
02/03/2026, 15:00 - Rahul: Sent invoice #1046 ₹138,000
02/03/2026, 15:30 - Priya: Approved invoice #1046
02/03/2026, 17:30 - Rahul: Payment received #1046 ₹138,000
02/03/2026, 17:32 - Arjun: good
03/03/2026, 08:30 - Rahul: Sent invoice #1047 ₹74,000
03/03/2026, 09:00 - Priya: Approved invoice #1047
03/03/2026, 10:30 - Rahul: Payment received #1047 ₹74,000
03/03/2026, 10:35 - Meena: smooth
03/03/2026, 11:00 - Rahul: Sent invoice #1048 ₹380,000 to retail chain client
03/03/2026, 11:05 - Arjun: big retail client?
03/03/2026, 11:08 - Rahul: yes 5 locations
03/03/2026, 11:10 - Arjun: nice
03/03/2026, 12:00 - Priya: Approved invoice #1048
03/03/2026, 14:00 - Rahul: Payment received #1048 ₹380,000 paid for all 5 locations
03/03/2026, 14:02 - Meena: big one!
03/03/2026, 14:03 - Arjun: excellent
03/03/2026, 15:00 - Rahul: Sent invoice #1049 ₹66,000
03/03/2026, 15:30 - Priya: Approved invoice #1049
03/03/2026, 17:00 - Rahul: Payment received #1049 ₹66,000
03/03/2026, 17:05 - Arjun: great day
04/03/2026, 09:00 - Rahul: Sent invoice #1050 ₹195,000 milestone invoice!
04/03/2026, 09:05 - Meena: 50th invoice this cycle wow
04/03/2026, 09:08 - Arjun: team is crushing it
04/03/2026, 09:30 - Priya: Approved invoice #1050 milestone approved!
04/03/2026, 10:30 - Rahul: Payment received #1050 ₹195,000 milestone paid!
04/03/2026, 10:32 - Meena: 🎉
04/03/2026, 10:33 - Arjun: great work team Rahul Priya Meena all of you
04/03/2026, 10:35 - Priya: team effort!`;

  const loadDemo = () => {
    const blob = new Blob([DEMO_LOG], { type: "text/plain" });
    const file = new File([blob], "demo_invoice_log.txt", { type: "text/plain" });
    processFile(file);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="page-header fade-up">
        <div className="page-title">Upload Business Data</div>
        <div className="page-sub">
          Supports business communication exports (.txt) and CSV files — WhatsApp, Teams, Slack, and more.
        </div>
      </div>

      <div
        className={`upload-zone fade-up delay-1 ${dragging ? "drag-over" : ""}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".txt,.csv" style={{ display: "none" }}
          onChange={e => processFile(e.target.files[0])} />
        <div className="upload-icon">📂</div>
        <div className="upload-title">{file ? file.name : "Drop your communication log here"}</div>
        <div className="upload-sub">{file ? `${(file.size / 1024).toFixed(1)} KB · ready to process` : "or click to browse files"}</div>
        {!loading && (
          <button className="btn btn-primary" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
            Choose File
          </button>
        )}
        <div className="format-tags">
          <span className="format-tag">.txt</span>
          <span className="format-tag">.csv</span>
          <span className="format-tag">WhatsApp Export</span>
        </div>
      </div>

      {/* Format instructions collapsible */}
      <div className="card fade-up delay-1" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowFormat(f => !f); }}
          style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}
        >
          <span>📋 Expected log format</span>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>{showFormat ? "▲ Hide" : "▼ Show"}</span>
        </button>
        {showFormat && (
          <div style={{ padding: "0 14px 14px", fontSize: 12, color: "var(--text-3)" }}>
            <pre style={{ background: "var(--surface-2)", padding: "10px 12px", borderRadius: 6, fontSize: 11, fontFamily: "var(--mono)", overflowX: "auto", whiteSpace: "pre", lineHeight: 1.6 }}>
              {`12/01/2026, 10:15 - Ravi: sent invoice #1042 for ₹85,000
12/01/2026, 12:30 - Priya: approved invoice #1042
12/01/2026, 16:45 - Amit: payment received for invoice #1042`}
            </pre>
            <div style={{ marginTop: 8, lineHeight: 1.6 }}>
              Supports Android (.txt), iOS (.txt), and regional date formats (DD/MM/YYYY, MM/DD/YYYY).
            </div>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div className="progress-steps fade-up">
          {steps.map((s, i) => (
            <div key={i} className={`progress-step ${s.state}`}>
              <div className={`step-dot ${s.state === "active" ? "pulse" : ""}`} />
              {s.state === "done" ? "✓ " : ""}{s.label}
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className={`status-bar ${status.type} fade-up`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{status.type === "success" ? "✓" : status.type === "info" ? "⚡" : "✕"} {status.message}</span>
          {status.type === "error" && (
            <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, fontSize: 11 }} onClick={resetUpload}>
              ↺ Try Again
            </button>
          )}
        </div>
      )}

      <div className="divider" style={{ marginTop: 24 }} />

      <div className="card fade-up delay-2" style={{ background: "var(--blue-dim)", borderColor: "rgba(59,130,246,.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--blue-bright)", marginBottom: 2 }}>⚡ Try a live demo — no upload needed</div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>70 real invoices · 5 actors · processed live through AI right now</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={loadDemo} disabled={loading}>Run Demo →</button>
        </div>
      </div>


    </div>
  );
}

// ─── SOP ─────────────────────────────────────────────────────────────────────
function SOP({ data }) {
  const navigate = useNavigate();
  const [sop, setSop] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!data) return;
    // Don't clear SOP immediately so we can show "Regenerating..." cleanly
    setLoading(true); setError("");
    try {
      // Try Groq first, falls back to Gemini on the backend
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${API_BASE}/sop-groq`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: buildProcessContext(data), metrics: data.metrics }),
        signal: controller.signal
      });
      const result = await res.json();
      if (!res.ok) { setError(result.detail || "SOP generation failed. Retrying…"); setSop(null); return; }
      setSop(result.sop);
    } catch (err) { setError(err?.name === "AbortError" ? "Request timed out. Please try again." : "AI service temporarily unavailable. Please try again."); setSop(null); }
    finally { setLoading(false); }
  };

  const downloadPDF = async () => {
    if (!sop) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), m = 20, cW = W - m * 2;
    let y = 0;
    const chk = (n = 10) => { if (y + n > 270) { doc.addPage(); y = 20; } };

    doc.setFillColor(26, 58, 92); doc.rect(0, 0, W, 42, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(17); doc.setFont("helvetica", "bold"); doc.text(sop.title, m, 16);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, m, 26);
    doc.text("FlowLens AI — Auto-Generated SOP", m, 34);
    y = 52; doc.setTextColor(0, 0, 0);

    const sec = (t) => { chk(14); doc.setFillColor(234, 241, 248); doc.rect(m, y, cW, 8, "F"); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(26, 58, 92); doc.text(t, m + 3, y + 5.5); doc.setTextColor(0, 0, 0); y += 12; };
    const body = (l, v) => { chk(8); doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.text(`${l}:`, m, y); doc.setFont("helvetica", "normal"); const lines = doc.splitTextToSize(v, cW - 30); doc.text(lines, m + 28, y); y += lines.length * 5 + 3; };

    sec("1. Overview"); body("Objective", sop.objective); body("Scope", sop.scope); y += 4;
    sec("2. Roles & Responsibilities");
    sop.roles.forEach((r, i) => { chk(8); doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.text(`${i + 1}. ${r.name}`, m + 2, y); doc.setFont("helvetica", "normal"); const l = doc.splitTextToSize(r.responsibility, cW - 30); doc.text(l, m + 32, y); y += l.length * 5 + 3; }); y += 4;
    sec("3. Process Steps");
    sop.steps.forEach(s => { chk(28); doc.setFillColor(249, 249, 249); doc.setDrawColor(220, 220, 220); doc.roundedRect(m, y, cW, 26, 2, 2, "FD"); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(26, 58, 92); doc.text(`Step ${s.step}: ${s.stage}`, m + 4, y + 7); doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(55, 65, 81); doc.text(`Actor: ${s.actor}`, m + 4, y + 13); doc.text(`Action: ${s.action}`, m + 4, y + 18); doc.text(`SLA: ${s.sla}`, m + 4, y + 23); const el = doc.splitTextToSize(`Escalation: ${s.escalation}`, cW / 2 - 6); doc.text(el, m + cW / 2 + 2, y + 13); doc.setTextColor(0, 0, 0); y += 30; });
    sec("4. KPIs");
    sop.kpis.forEach((k, i) => { chk(8); doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.text(`${i + 1}. ${k.metric}:`, m + 2, y); doc.setFont("helvetica", "normal"); doc.text(k.target, m + 60, y); y += 7; });

    const tp = doc.internal.getNumberOfPages();
    for (let p = 1; p <= tp; p++) { doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(160, 160, 160); doc.text(`FlowLens AI  |  Auto-Generated SOP  |  Page ${p} of ${tp}`, m, 290); }
    doc.save(`SOP_${sop.title.replace(/\s+/g, "_")}.pdf`);
  };

  if (!data) return (
    <div>
      <div className="page-header fade-up"><div className="page-title">Generated SOPs</div></div>
      <div className="empty-state fade-up delay-1">
        <div className="empty-icon">📄</div>
        <div className="empty-title">No data uploaded yet</div>
        <div className="empty-sub">Upload a communication log first, then return here to generate your SOP.</div>
        <button className="btn btn-primary" onClick={() => navigate("/upload")}>Go to Upload →</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-header fade-up">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">Generated SOPs</div>
            <div className="page-sub">Auto-generated from your uploaded process data</div>
          </div>
          {sop && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {loading && <span style={{ fontSize: 11, color: "var(--text-3)", marginRight: 8 }}>Regenerating with updated process data…</span>}
              <button className="btn btn-primary btn-sm" onClick={downloadPDF} disabled={loading}>↓ Download PDF</button>
              <button className="btn btn-ghost btn-sm" onClick={generate} disabled={loading}>Regenerate</button>
            </div>
          )}
        </div>
      </div>

      {!sop && (
        <div className="empty-state fade-up delay-1">
          <div className="empty-icon">📄</div>
          <div className="empty-title">Ready to generate</div>
          <div className="empty-sub">We'll use your process data and AI insights to build a professional SOP with roles, steps, SLAs, and KPIs.</div>
          <button className="btn btn-primary btn-lg" onClick={generate} disabled={loading}>
            {loading ? "Generating…" : "Generate SOP"}
          </button>
          {error && <div className="status-bar error" style={{ marginTop: 14 }}>✕ {error}</div>}
        </div>
      )}

      {sop && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }} className="fade-up">

          {/* Document Header */}
          <div className="sop-header">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, opacity: .75, letterSpacing: 1.2, marginBottom: 6, textTransform: "uppercase", fontFamily: "var(--mono)" }}>
                  {sop.doc_id || "SOP-FIN-INV-001"} &nbsp;·&nbsp; {sop.version || "v1.0"} &nbsp;·&nbsp; Effective {sop.effective_date || new Date().toLocaleDateString()}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{sop.title}</div>
                <div style={{ fontSize: 13.5, opacity: .9, lineHeight: 1.6 }}>{sop.objective}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, opacity: .85, textAlign: "right", flexShrink: 0 }}>
                <span><b style={{ opacity: 1 }}>Document Owner:</b> {sop.document_owner || "Finance Manager"}</span>
                <span><b style={{ opacity: 1 }}>Approved by:</b> {sop.approved_by || "Head of Finance"}</span>
                <span><b style={{ opacity: 1 }}>Review date:</b> {sop.review_date || "—"}</span>
              </div>
            </div>
          </div>

          {/* Scope row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="sop-section" style={{ margin: 0 }}>
              <div className="sop-section-label">SCOPE</div>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.6 }}>{sop.scope || "—"}</p>
            </div>
            <div className="sop-section" style={{ margin: 0 }}>
              <div className="sop-section-label">OUT OF SCOPE</div>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.6 }}>{sop.out_of_scope || "—"}</p>
            </div>
          </div>

          {/* Prerequisites */}
          {sop.prerequisites?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">PREREQUISITES</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                {sop.prerequisites.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{safe(p)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Definitions */}
          {sop.definitions?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">DEFINITIONS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sop.definitions.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 700, color: "var(--text-1)", flexShrink: 0, minWidth: 120 }}>{safe(d.term)}</span>
                    <span style={{ color: "var(--text-2)" }}>{safe(d.definition)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Roles */}
          {sop.roles?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">ROLES & RESPONSIBILITIES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sop.roles.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, background: "var(--blue-dim)", border: "1px solid rgba(59,130,246,.15)", borderRadius: "var(--radius-md)", padding: "10px 14px", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 180, flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--blue-bright)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 2 }}>{safe(r.name)}</div>
                      {r.actor && <div style={{ fontSize: 11, color: "var(--text-3)" }}>Assigned: {safe(r.actor)}</div>}
                    </div>
                    <p style={{ fontSize: 12.5, color: "var(--text-2)", margin: 0, lineHeight: 1.6, flex: 1 }}>{safe(r.responsibility)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Process Steps */}
          {sop.steps?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">PROCESS STEPS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sop.steps.map((s, i) => (
                  <div key={i} className="sop-step">
                    {/* Step header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--blue)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.step ?? i + 1}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text-1)" }}>{safe(s.stage)}</div>
                          {s.role_title && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Responsible: {safe(s.role_title)}</div>}
                        </div>
                      </div>
                      {s.sla && safe(s.sla) && <span className="badge badge-blue" style={{ flexShrink: 0, marginLeft: 8 }}>SLA: {safe(s.sla)}</span>}
                    </div>

                    {/* Action */}
                    {s.action && safe(s.action) && (
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7, marginBottom: 8, padding: "10px 12px", background: "var(--surface)", borderRadius: 6, borderLeft: "3px solid var(--blue)" }}>
                        {safe(s.action)}
                      </div>
                    )}

                    {/* Inputs / Outputs as tags */}
                    {(s.inputs || s.outputs) && (
                      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        {s.inputs && safe(s.inputs) && (
                          <div style={{ flex: "1 1 200px", background: "var(--surface-2)", borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Required Inputs</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
                              {safe(s.inputs).split(",").map(item => item.trim()).filter(Boolean).map((item, idx) => (
                                <span key={idx} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: 11.5, color: "var(--text-2)" }}>{item}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {s.outputs && safe(s.outputs) && (
                          <div style={{ flex: "1 1 200px", background: "var(--surface-2)", borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Outputs Produced</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
                              {safe(s.outputs).split(",").map(item => item.trim()).filter(Boolean).map((item, idx) => (
                                <span key={idx} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: 11.5, color: "var(--text-2)" }}>{item}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Acceptance criteria */}
                    {s.acceptance && safe(s.acceptance) && (
                      <div style={{ fontSize: 12, color: "var(--green)", background: "var(--green-dim)", borderRadius: 6, padding: "6px 10px", marginBottom: 6, borderLeft: "3px solid var(--green)" }}>
                        <b>Acceptance Criteria: </b>{safe(s.acceptance)}
                      </div>
                    )}

                    {/* Decision point */}
                    {s.decision_point && safe(s.decision_point) && (
                      <div style={{ fontSize: 12, color: "var(--amber)", background: "var(--amber-dim)", borderRadius: 6, padding: "6px 10px", marginBottom: 6 }}>
                        <b>Decision Gate: </b>{safe(s.decision_point)}
                      </div>
                    )}

                    {/* Escalation */}
                    {s.escalation && safe(s.escalation) && (
                      <div style={{ fontSize: 12, color: "var(--red)", background: "var(--red-dim)", borderRadius: 6, padding: "6px 10px" }}>
                        <b>Escalation: </b>{safe(s.escalation)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exceptions */}
          {sop.exceptions?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">EXCEPTION HANDLING</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sop.exceptions.map((e, i) => (
                  <div key={i} style={{ background: "var(--amber-dim)", border: "1px solid rgba(245,158,11,.2)", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--amber)", marginBottom: 5 }}>{safe(e.scenario)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{safe(e.handling)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPIs */}
          {sop.kpis?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">KEY PERFORMANCE INDICATORS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 9 }}>
                {sop.kpis.map((k, i) => {
                  const currentVal = safe(k.current);
                  const targetVal = safe(k.target);
                  return (
                    <div key={i} style={{ background: "var(--green-dim)", border: "1px solid rgba(16,185,129,.2)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                      <div style={{ fontSize: 10.5, color: "var(--green)", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>{safe(k.metric)}</div>
                      {currentVal && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                          Current: <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--text-2)" }}>{currentVal}</span>
                        </div>
                      )}
                      {targetVal && (
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)", marginBottom: 4, fontFamily: "var(--mono)" }}>
                          Target: {targetVal}
                        </div>
                      )}
                      {k.measurement && safe(k.measurement) && (
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.4 }}>{safe(k.measurement)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Version History */}
          {sop.version_history?.length > 0 && (
            <div className="sop-section">
              <div className="sop-section-label">VERSION HISTORY</div>
              <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Version", "Date", "Author", "Changes"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--text-3)", fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sop.version_history.map((v, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", color: "var(--blue-bright)" }}>{safe(v.version)}</td>
                      <td style={{ padding: "7px 10px", color: "var(--text-2)" }}>{safe(v.date)}</td>
                      <td style={{ padding: "7px 10px", color: "var(--text-2)" }}>{safe(v.author)}</td>
                      <td style={{ padding: "7px 10px", color: "var(--text-2)" }}>{safe(v.changes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function Landing({ onGetStarted, onLoadSample }) {
  const [activeStep, setActiveStep] = useState(0);

  // Auto-advance the "how it works" demo
  useEffect(() => {
    const t = setInterval(() => setActiveStep(s => (s + 1) % 3), 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", paddingBottom: 48 }}>

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <div className="lp-hero fade-up">
        <div className="lp-eyebrow">
          <span className="lp-hw-dot live" />
          AI &amp; ML Track — HACKFUSION-2K26 &nbsp;·&nbsp; JNTUH Hyderabad
        </div>

        <h1 className="lp-h1">
          Your Invoice Approvals Are<br />
          <span className="lp-h1-accent">Bleeding Money. FlowLens Finds Exactly Where.</span>
        </h1>

        <p className="lp-sub">
          Indian SMEs lose an estimated ₹2.3 lakh crore annually to delayed invoice approvals and payment bottlenecks — most tracked over WhatsApp. FlowLens AI turns your conversation logs into a real-time operations dashboard: cycle times, SLA breaches, cost per delay, and AI-generated fixes.
        </p>

        <div className="lp-ctas">
          <button className="btn btn-primary btn-lg" onClick={onGetStarted}>
            Analyse my process →
          </button>
          <button className="btn btn-secondary btn-lg" onClick={onLoadSample}>
            Load sample data
          </button>
        </div>

        {/* AI Ready badge */}
        <div className="lp-status-row">
          <div className="lp-status-chip ok">
            <span className="lp-hw-dot sm live" />
            <span className="lp-status-label">AI Ready</span>
            <span className="lp-status-val">Groq + Gemini configured</span>
          </div>
        </div>
      </div>

      {/* ── THE PROBLEM ───────────────────────────────────────────────── */}
      <div className="lp-section fade-up delay-1">
        <div className="lp-section-label">THE PROBLEM</div>
        <h2 className="lp-h2">₹2.3L crore stuck in delayed SME payments</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { stat: "28%", desc: "of invoices breach SLA every month (industry average)" },
              { stat: "4+ hrs", desc: "per week spent manually chasing approvals over WhatsApp" },
              { stat: "Zero", desc: "visibility into where delays happen or what they cost" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--red)", fontFamily: "var(--mono)", minWidth: 70, flexShrink: 0 }}>{item.stat}</div>
                <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "var(--surface-2)", borderRadius: "var(--radius-lg)", padding: "20px 24px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: "var(--text-3)" }}>Before → After</div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ flex: 1, padding: "12px 14px", background: "var(--red-dim)", borderRadius: 8, border: "1px solid rgba(239,68,68,.2)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--red)", marginBottom: 4 }}>BEFORE</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>Manual WhatsApp threads, no metrics, delays invisible</div>
              </div>
              <div style={{ fontSize: 18, color: "var(--text-3)" }}>→</div>
              <div style={{ flex: 1, padding: "12px 14px", background: "var(--green-dim)", borderRadius: 8, border: "1px solid rgba(16,185,129,.2)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--green)", marginBottom: 4 }}>AFTER</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>Live dashboard, AI insights, cost savings quantified</div>
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--blue-bright)", textAlign: "center" }}>
              FlowLens turns that chaos into a dashboard.
            </div>
          </div>
        </div>
      </div>

      {/* ── PRODUCT MOCKUP ───────────────────────────────────────────── */}
      <div className="lp-mockup-wrap fade-up delay-2">
        <div className="lp-mockup-badge">Live product preview</div>
        <div className="lp-mockup">
          <div className="lp-mock-topbar">
            <div className="lp-mock-logo">⚡ FlowLens AI</div>
            <div className="lp-mock-nav">
              {["Dashboard", "Upload", "SOP", "Copilot"].map((n, i) => (
                <span key={n} className={`lp-mock-nav-item${i === 0 ? " active" : ""}`}>{n}</span>
              ))}
            </div>
          </div>
          <div className="lp-mock-body">
            <div className="lp-mock-kpis">
              {[
                { label: "TOTAL CASES", val: "120", sub: "invoices", color: "#1a3a5c" },
                { label: "AVG CYCLE TIME", val: "7.4h", sub: "±3.2h variance", color: "#c98f00" },
                { label: "BOTTLENECK", val: "PAYMENT", sub: "8.9h avg", color: "#c93030" },
                { label: "SLA BREACHES", val: "53", sub: "44% breach rate", color: "#c93030" },
              ].map(k => (
                <div key={k.label} className="lp-mock-kpi" style={{ "--kc": k.color }}>
                  <div className="lp-mock-kpi-label">{k.label}</div>
                  <div className="lp-mock-kpi-val">{k.val}</div>
                  <div className="lp-mock-kpi-sub">{k.sub}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div className="lp-mock-card" style={{ flex: 2 }}>
                <div className="lp-mock-card-label">PROCESS FLOW</div>
                <div className="lp-mock-flow">
                  {[
                    { name: "APPROVAL", dur: "2.8h", bot: false },
                    { name: "PAYMENT", dur: "8.9h", bot: true },
                    { name: "REFUND", dur: "1.9h", bot: false },
                  ].map((s, i) => (
                    <div key={s.name} style={{ display: "flex", alignItems: "center" }}>
                      <div className={`lp-mock-stage${s.bot ? " bot" : ""}`}>
                        <div className="lp-mock-stage-name">{s.name}</div>
                        <div className="lp-mock-stage-dur">{s.dur}</div>
                        {s.bot && <div className="lp-mock-stage-flag">⚠ BOTTLENECK</div>}
                      </div>
                      {i < 2 && <div className="lp-mock-arrow">→</div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="lp-mock-card" style={{ flex: 1 }}>
                <div className="lp-mock-card-label">MONTHLY COST</div>
                {[
                  { l: "Labor", v: "₹5.3L", w: 63 },
                  { l: "SLA fines", v: "₹2.7L", w: 31 },
                  { l: "Cash flow", v: "₹50K", w: 6 },
                ].map(r => (
                  <div key={r.l} className="lp-mock-cost-row">
                    <span className="lp-mock-cost-label">{r.l}</span>
                    <div className="lp-mock-bar-track">
                      <div className="lp-mock-bar-fill" style={{ width: `${r.w}%` }} />
                    </div>
                    <span className="lp-mock-cost-val">{r.v}</span>
                  </div>
                ))}
                <div className="lp-mock-cost-total">Total: ₹8.5L/mo</div>
              </div>
            </div>
            <div className="lp-mock-card lp-mock-insight">
              <span className="lp-mock-insight-icon">⚠</span>
              <span>PAYMENT stage averages <b>8.9h</b>, exceeding the 4h SLA — responsible for <b>31 of 53</b> breaches this month.</span>
              <span className="lp-mock-insight-tag">AI Insight</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <div className="lp-section fade-up delay-3">
        <div className="lp-section-label">HOW IT WORKS</div>
        <h2 className="lp-h2">From communication log to cost savings in 3 steps</h2>

        <div className="lp-steps">
          {[
            {
              n: "01", title: "Drop your communication log",
              body: "Export your team's invoice discussion thread as a .txt file. FlowLens parses every timestamp, actor, and action — from 'sent invoice #1042' to 'approved' to 'payment received.'",
              detail: ["📂 .txt / .csv accepted", "4 date formats supported", "Android & iOS exports"],
              color: "var(--blue)",
            },
            {
              n: "02", title: "AI mines your workflow",
              body: "Our process mining engine extracts cycle times, SLA compliance, bottleneck stages, and actor performance. Groq (Llama 3.3 70B) generates narrative insights at 500+ tokens/sec.",
              detail: ["M/M/c queuing theory", "Little's Law cycle time", "Actor load distribution"],
              color: "var(--amber)",
            },
            {
              n: "03", title: "Simulate & export",
              body: "Simulate adding an approver, enabling auto-approval, or smart routing. See the exact rupee savings. Export a professional SOP PDF — ready to hand to your finance manager.",
              detail: ["What-if ROI simulator", "SOP PDF auto-generated", "Copilot Q&A on your data"],
              color: "var(--green)",
            },
          ].map((step, i) => (
            <div key={i} className={`lp-step${activeStep === i ? " active" : ""}`}
              onClick={() => setActiveStep(i)}>
              <div className="lp-step-n" style={{ color: step.color }}>{step.n}</div>
              <div className="lp-step-title">{step.title}</div>
              <div className="lp-step-body">{step.body}</div>
              <ul className="lp-step-detail">
                {step.detail.map(d => <li key={d}>{d}</li>)}
              </ul>
              <div className="lp-step-bar" style={{ background: step.color, opacity: activeStep === i ? 1 : 0 }} />
            </div>
          ))}
        </div>
      </div>

      {/* ── CAPABILITY GRID ──────────────────────────────────────────── */}
      <div className="lp-section fade-up delay-4">
        <div className="lp-section-label">CAPABILITIES</div>
        <h2 className="lp-h2">Everything in one place</h2>

        <div className="lp-caps">
          {[
            { icon: "🔍", title: "Workflow Analytics", body: "Automatically extracts workflow stages, handoffs, and SLA events from unstructured business messages — no manual tagging." },
            { icon: "💰", title: "Financial Quantification", body: "Computes labor cost, SLA penalty exposure, and cash-flow opportunity cost per case using Little's Law." },
            { icon: "📊", title: "What-If Simulator", body: "Model staffing changes, auto-approval thresholds, or routing rules and see the predicted monthly savings." },
            { icon: "📄", title: "SOP Generator", body: "One click generates a professional Standard Operating Procedure PDF with roles, SLAs, and escalation paths." },
            { icon: "🤖", title: "AI Copilot", body: "Ask anything about your process in plain language. Answers grounded in your actual data, not generic advice." },
            { icon: "⚡", title: "Dual AI Engine", body: "Groq (Llama 3.3 70B) for sub-second inference, with Gemini 2.5 Flash as automatic fallback. No single point of failure." },
          ].map(c => (
            <div key={c.title} className="lp-cap">
              <div className="lp-cap-icon">{c.icon}</div>
              <div className="lp-cap-title">{c.title}</div>
              <div className="lp-cap-body">{c.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <div className="lp-cta-bar fade-up delay-5">
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "white", letterSpacing: "-0.4px", marginBottom: 4 }}>
            Ready to see your process?
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            Upload a WhatsApp export or load the sample data — results in under 5 seconds.
          </div>
        </div>
        <button className="btn btn-lg" style={{ background: "white", color: "var(--blue)", fontWeight: 700, flexShrink: 0 }}
          onClick={onGetStarted}>
          Start analysis →
        </button>
      </div>

    </div>
  );
}


// ─── COPILOT ──────────────────────────────────────────────────────────────────
const CHIPS = [
  "What's our biggest bottleneck?",
  "Which actor is most overloaded?",
  "How can we cut SLA breaches?",
  "What's the monthly cost of our process?",
  "Which invoices take longest to collect?",
];

function Copilot({ data }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState(() =>
    loadPersisted(CHAT_KEY) || [{ role: "assistant", text: "Ask FlowLens anything about your invoice workflow — 'Why are we breaching SLA?', 'How much is the PAYMENT bottleneck costing us?', 'What would happen if we added an approver?'" }]
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef();

  useEffect(() => { savePersisted(CHAT_KEY, messages); }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (text) => {
    const msg = text || input;
    if (!msg.trim()) return;
    const updated = [...messages, { role: "user", text: msg }];
    setMessages(updated); setInput(""); setLoading(true);
    try {
      // Try Groq streaming first
      const res = await fetch(`${API_BASE}/chat-groq`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: msg, context: buildProcessContext(data) }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        // SSE streaming from Groq
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        setMessages(prev => [...prev, { role: "assistant", text: "" }]);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.token) {
                accumulated += parsed.token;
                setMessages(prev => { const copy = [...prev]; copy[copy.length - 1] = { role: "assistant", text: accumulated }; return copy; });
              }
              if (parsed.done) break;
              if (parsed.error) { accumulated = parsed.error; break; }
            } catch { /* partial chunk */ }
          }
        }
        if (!accumulated) setMessages(prev => { const copy = [...prev]; copy[copy.length - 1] = { role: "assistant", text: "No response received. Please try again." }; return copy; });
      } else {
        // Non-streaming fallback (Gemini)
        const result = await res.json();
        if (!res.ok) {
          setMessages(prev => [...prev, { role: "assistant", text: result.detail || "AI service temporarily unavailable." }]);
        } else {
          setMessages(prev => [...prev, { role: "assistant", text: result.reply }]);
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "AI service temporarily unavailable. Please check your connection and try again." }]);
    } finally { setLoading(false); }
  };

  const clearChat = () => {
    const fresh = [{ role: "assistant", text: "Chat cleared. What would you like to know?" }];
    setMessages(fresh); savePersisted(CHAT_KEY, fresh);
  };


  return (
    <div style={{ display: "flex", gap: 20, height: "calc(100vh - 120px)" }}>

      {/* ── LEFT: AI Insights Panel (wider) ── */}
      <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", overflowY: "auto", paddingRight: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: "var(--text-3)", marginBottom: 14, paddingTop: 4 }}>
          Process Intelligence
        </div>
        {data?.ai_insights ? (
          <div className="fade-up delay-1" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.keys(INSIGHT_META).map(key => {
              const meta = INSIGHT_META[key];
              const items = data.ai_insights[key];
              if (!items?.length) return null;
              return (
                <div key={key} style={{ background: meta.bg, border: `1px solid ${meta.color}28`, borderRadius: "var(--radius-lg)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 14 }}>{meta.icon}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: ".6px" }}>{meta.label}</span>
                    <span className="badge badge-blue" style={{ marginLeft: "auto", fontSize: 10 }}>{items.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {items.map((point, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: meta.color, flexShrink: 0, marginTop: 6 }} />
                        <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>{point}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {data.baseline_costs && (
              <div style={{ background: "var(--red-dim)", border: "1px solid rgba(239,68,68,.2)", borderRadius: "var(--radius-lg)", padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", color: "var(--red)", marginBottom: 10 }}>
                  Monthly Cost Breakdown
                </div>
                {[
                  ["Labor", data.baseline_costs.labor_cost],
                  ["SLA Penalties", data.baseline_costs.sla_breach_cost],
                  ["Cash Flow Loss", data.baseline_costs.cash_flow_opportunity_cost],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--text-2)", marginBottom: 6 }}>
                    <span>{l}</span>
                    <span style={{ fontWeight: 600, color: "var(--text-1)", fontFamily: "var(--mono)" }}>{fmt(v)}</span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid rgba(239,68,68,.15)", margin: "8px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "var(--red)" }}>
                  <span>Total Monthly</span>
                  <span style={{ fontFamily: "var(--mono)" }}>{fmt(data.baseline_costs.total_monthly_cost)}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: "var(--surface-2)", borderRadius: "var(--radius-lg)", padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>💡</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 6 }}>No insights yet</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>Upload process data to see AI insights here</div>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/upload")}>Upload →</button>
          </div>
        )}
      </div>

      {/* ── RIGHT: Chatbot (narrower, fixed width) ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="page-header fade-up" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div className="page-title">AI Copilot</div>
              <div className="page-sub">{data ? "Live data loaded — ask anything" : "Upload data to unlock full context"}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={clearChat}>Clear chat</button>
          </div>
        </div>

        <div className="chat-shell fade-up delay-1" style={{ flex: 1 }}>
          <div className="chat-header">
            <div className="chat-avatar">🤖</div>
            <div>
              <div className="chat-name">FlowLens Copilot</div>
              <div className="chat-status"><span className="chat-dot" />online · context loaded</div>
            </div>
          </div>
          <div className="chat-chips">
            {CHIPS.map((chip, i) => (
              <button key={i} className="chat-chip" onClick={() => send(chip)} disabled={loading}>{chip}</button>
            ))}
          </div>
          <div className="chat-msgs">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-bubble ${msg.role}`}>{msg.text}</div>
            ))}
            {loading && (
              <div className="chat-typing">
                <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="chat-input-row">
            <textarea className="chat-input" rows={1} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask anything about your process data…" />
            <button className="btn btn-primary" style={{ padding: "8px 14px" }}
              onClick={() => send()} disabled={loading || !input.trim()}>↑</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
function App() {
  const [data, setData] = useState(() => loadPersisted(STORAGE_KEY));

  const handleSetData = (d) => { savePersisted(STORAGE_KEY, d); setData(d); };
  const clearData = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CHAT_KEY);
    setData(null);
  };

  return (
    <Router>
      <AppInner
        data={data}
        handleSetData={handleSetData}
        clearData={clearData}
      />
    </Router>
  );
}

// Inner component — useNavigate must be inside <Router>
function AppInner({ data, handleSetData, clearData }) {
  const navigate = useNavigate();

  return (
    <div className="app-container">
      <nav className="topbar">
        <NavLink to="/" style={{ textDecoration: "none", marginRight: "auto" }}>
          <div className="logo">
            <div className="logo-icon">⚡</div>
            <div className="logo-text">
              <span className="logo-name">FlowLens AI</span>
              <span className="logo-tag">Process Intelligence</span>
            </div>
          </div>
        </NavLink>

        <div className="nav-links">
          {[
            { to: "/dashboard", label: "Dashboard" },
            { to: "/upload", label: "Upload" },
            { to: "/sop", label: "SOP" },
            { to: "/copilot", label: "Copilot" },
          ].map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              {label}
            </NavLink>
          ))}
        </div>

        {/* New Analysis flush button — only visible when data is loaded */}
        {data && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: "var(--red)", borderColor: "rgba(239,68,68,.3)", marginLeft: 4 }}
            onClick={() => { clearData(); navigate("/upload"); }}
            title="Clear current analysis and upload new data"
          >
            ↺ New Analysis
          </button>
        )}
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={
            <Landing onGetStarted={() => navigate("/upload")} onLoadSample={() => navigate("/upload")} />
          } />
          <Route path="/dashboard" element={
            <Dashboard data={data} />
          } />
          <Route path="/upload" element={
            <Upload setData={handleSetData} />
          } />
          <Route path="/sop" element={<SOP data={data} />} />
          <Route path="/copilot" element={<Copilot data={data} />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;