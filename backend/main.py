import os
import re
import json
import time
from datetime import datetime, date
from collections import defaultdict, Counter
from typing import List, Dict, Optional
from dataclasses import dataclass
from enum import Enum
import statistics

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

# ── Config ──────────────────────────────────────────────────────────────────

load_dotenv(override=True)

# ── API Keys ─────────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GROQ_API_KEY   = os.getenv("GROQ_API_KEY",   "").strip()

if not GROQ_API_KEY and not GEMINI_API_KEY:
    print("WARNING: Neither GROQ_API_KEY nor GEMINI_API_KEY set. AI insights will return placeholder data.")

# ── Server ────────────────────────────────────────────────────────────────────
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
APP_ENV      = os.getenv("APP_ENV", "development")

# ── Upload limits ─────────────────────────────────────────────────────────────
MAX_FILE_SIZE      = int(os.getenv("MAX_FILE_SIZE_BYTES", str(5 * 1024 * 1024)))
ALLOWED_EXTENSIONS = tuple(e.strip() for e in os.getenv("ALLOWED_EXTENSIONS", ".txt,.csv").split(","))

# ── AI Models ─────────────────────────────────────────────────────────────────
GEMINI_MODEL    = os.getenv("GEMINI_MODEL",    "gemini-2.5-flash")
GROQ_MODEL      = os.getenv("GROQ_MODEL",      "llama-3.3-70b-versatile")
GROQ_MODEL_FAST = os.getenv("GROQ_MODEL_FAST", "llama-3.1-8b-instant")

GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"

# ── Financial model defaults ──────────────────────────────────────────────────
SLA_RULES = {"APPROVAL": 2, "PAYMENT": 4, "REFUND_COMPLETED": 6}

DEFAULT_COSTS = {
    "hourly_labor_cost":     float(os.getenv("DEFAULT_HOURLY_LABOR_COST",      "500")),
    "sla_breach_penalty":    float(os.getenv("DEFAULT_SLA_BREACH_PENALTY",     "5000")),
    "cost_of_capital_daily": float(os.getenv("DEFAULT_COST_OF_CAPITAL_DAILY",  "0.0005")),
}

# Simulation model constants
QUEUING_THEORY_EXPONENT      = 0.6
SMART_ROUTING_IMPROVEMENT    = 0.25
EFFICIENCY_MAX_SLA_PENALTY   = 40
EFFICIENCY_MAX_CYCLE_PENALTY = 30
EFFICIENCY_BOTTLENECK_PENALTY = 20
AUTO_APPROVAL_MAX_PCT        = 0.7
SLA_BREACH_REDUCTION_FACTOR  = 0.8
AUTO_APPROVAL_SLA_IMPACT     = 0.9
SMART_ROUTING_SLA_FACTOR     = 0.7

# Simulation cost constants
MONTHLY_HOURS_PER_EMPLOYEE = 160
AUTO_APPROVAL_SETUP_COST   = 50_000
SMART_ROUTING_MONTHLY_COST = 15_000

# Validation limits
MAX_ADDITIONAL_APPROVERS    = 20
MIN_ADDITIONAL_APPROVERS    = 1
MAX_AUTO_APPROVAL_THRESHOLD = 10_000
MIN_AUTO_APPROVAL_THRESHOLD = 1
MAX_TARGET_REDUCTION_PCT    = 90
MIN_TARGET_REDUCTION_PCT    = 1

app = FastAPI(
    title="FlowLens AI — Process Intelligence",
    docs_url="/docs" if APP_ENV == "development" else None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health check system ──────────────────────────────────────────────────────

class HealthStatus(Enum):
    HEALTHY  = "healthy"
    DEGRADED = "degraded"
    CRITICAL = "critical"


@dataclass
class HealthCheck:
    name: str
    status: HealthStatus
    message: str
    fix_instructions: Optional[str] = None


class EnvironmentValidator:
    """Validates all required dependencies and environment variables on startup."""

    def __init__(self):
        self.checks: List[HealthCheck] = []

    def check_gemini_api_key(self) -> HealthCheck:
        if GEMINI_API_KEY:
            return HealthCheck("Gemini API Key", HealthStatus.HEALTHY, f"API key configured ({GEMINI_API_KEY[:8]}...)")
        return HealthCheck(
            "Gemini API Key", HealthStatus.DEGRADED,
            "GEMINI_API_KEY environment variable not set",
            "1. Get API key from https://aistudio.google.com/app/apikey\n"
            "2. Set: export GEMINI_API_KEY=your_key_here\n"
            "3. Restart server",
        )

    def check_groq_api_key(self) -> HealthCheck:
        if GROQ_API_KEY:
            return HealthCheck("Groq API Key", HealthStatus.HEALTHY, f"API key configured ({GROQ_API_KEY[:8]}...)")
        return HealthCheck(
            "Groq API Key", HealthStatus.DEGRADED,
            "GROQ_API_KEY environment variable not set — Groq inference unavailable, will fall back to Gemini",
            "1. Get API key from https://console.groq.com\n"
            "2. Set: export GROQ_API_KEY=your_key_here\n"
            "3. Restart server",
        )

    async def run_all_checks(self) -> Dict:
        self.checks = [
            self.check_groq_api_key(),
            self.check_gemini_api_key(),
        ]
        critical = sum(1 for c in self.checks if c.status == HealthStatus.CRITICAL)
        degraded  = sum(1 for c in self.checks if c.status == HealthStatus.DEGRADED)
        healthy   = sum(1 for c in self.checks if c.status == HealthStatus.HEALTHY)
        overall   = HealthStatus.CRITICAL if critical else (HealthStatus.DEGRADED if degraded else HealthStatus.HEALTHY)
        return {
            "overall_status": overall.value,
            "checks": [
                {"name": c.name, "status": c.status.value, "message": c.message, "fix_instructions": c.fix_instructions}
                for c in self.checks
            ],
            "summary": {"healthy": healthy, "degraded": degraded, "critical": critical, "total": len(self.checks)},
        }

    def print_startup_report(self, report: Dict):
        icons = {"healthy": "[OK]", "degraded": "[!!]", "critical": "[XX]"}
        print("\n" + "=" * 70)
        print(">> FlowLens AI — Startup Health Check")
        print("=" * 70 + "\n")
        for check in report["checks"]:
            print(f"{icons.get(check['status'], '[??]')} {check['name']}\n   {check['message']}")
            if check.get("fix_instructions"):
                print("\n   How to fix:")
                for line in check["fix_instructions"].split("\n"):
                    print(f"      {line}")
            print()
        s = report["summary"]
        print("-" * 70)
        print(f"Summary: {s['healthy']}/{s['total']} healthy, {s['degraded']} degraded, {s['critical']} critical")
        print("=" * 70 + "\n")
        if report["overall_status"] == "degraded":
            print("[!!] WARNING: Server starting in degraded mode. Some AI features may use fallback models.\n")


validator = EnvironmentValidator()


@app.on_event("startup")
async def startup_health_check():
    report = await validator.run_all_checks()
    validator.print_startup_report(report)


@app.get("/health")
async def health_check():
    return await validator.run_all_checks()


@app.get("/health/summary")
async def health_summary():
    report = await validator.run_all_checks()
    return {
        "status":       report["overall_status"],
        "groq_ready":   any(c["name"] == "Groq API Key" and c["status"] == "healthy" for c in report["checks"]),
        "gemini_ready": any(c["name"] == "Gemini API Key" and c["status"] == "healthy" for c in report["checks"]),
        "issues": [
            {"name": c["name"], "severity": c["status"], "message": c["message"]}
            for c in report["checks"] if c["status"] != "healthy"
        ],
    }

# ── Pydantic models ──────────────────────────────────────────────────────────

class WhatIfRequest(BaseModel):
    scenario: str
    metrics: Dict
    params: Dict = {}
    cost_config: Optional[Dict] = None

# ── Log parsing ──────────────────────────────────────────────────────────────

ACTION_MAP = {
    "sent invoice":     "INVOICE_SENT",
    "approved":         "APPROVAL",
    "payment received": "PAYMENT",
    "refund initiated": "REFUND_INITIATED",
    "refund completed": "REFUND_COMPLETED",
}

INVOICE_PATTERN = re.compile(r"#(\d+)")
AMOUNT_PATTERN  = re.compile(r"₹([\d,]+)")

LOG_PATTERNS = [
    re.compile(r"(\d{1,2}/\d{1,2}/\d{4}), (\d{1,2}:\d{2}) - (.+?): (.+)"),
    re.compile(r"\[(\d{1,2}/\d{1,2}/\d{4}), (\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\] (.+?): (.+)"),
    re.compile(r"(\d{1,2}\.\d{1,2}\.\d{4}), (\d{1,2}:\d{2}) - (.+?): (.+)"),
    re.compile(r"(\d{1,2}/\d{1,2}/\d{2,4}), (\d{1,2}:\d{2}\s*[APap][Mm]?) - (.+?): (.+)"),
]

DATE_FORMATS = [
    "%d/%m/%Y %H:%M", "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %I:%M %p",
    "%d.%m.%Y %H:%M", "%m/%d/%Y %H:%M", "%m/%d/%y %H:%M",
]


def try_parse_timestamp(date_part: str, time_part: str) -> Optional[datetime]:
    combined = f"{date_part} {time_part}".strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(combined, fmt)
        except ValueError:
            continue
    return None


class Event:
    def __init__(self, timestamp, actor, action, case_id, amount=None):
        self.timestamp = timestamp
        self.actor     = actor
        self.action    = action
        self.case_id   = case_id
        self.amount    = amount


def parse_log(text: str) -> List[Event]:
    """Parse chat log text into structured workflow events."""
    events = []
    for line in text.splitlines():
        matched = next((p.match(line) for p in LOG_PATTERNS if p.match(line)), None)
        if not matched:
            continue
        date_part, time_part, actor, message = matched.groups()
        if not actor.strip() or not message.strip():
            continue
        timestamp = try_parse_timestamp(date_part, time_part)
        if not timestamp:
            continue
        invoice_match = INVOICE_PATTERN.search(message)
        if not invoice_match:
            continue
        case_id      = invoice_match.group(1)
        amount_match = AMOUNT_PATTERN.search(message)
        amount       = float(amount_match.group(1).replace(",", "")) if amount_match else None
        action       = next((v for k, v in ACTION_MAP.items() if k in message.lower()), None)
        if action:
            events.append(Event(timestamp, actor, action, case_id, amount))
    return events

# ── Process mining core ──────────────────────────────────────────────────────

def analyze_cases(events: List[Event]) -> Dict:
    """Compute cycle times, stage durations, SLA breaches, actor performance, and financial metrics."""
    if not events:
        return {
            "total_cases": 0, "average_cycle_time_hours": 0, "cycle_time_std_dev": 0,
            "average_stage_durations_hours": {}, "bottleneck_stage": None,
            "sla_breaches": {}, "actor_performance_avg_hours": {}, "financial_metrics": {},
        }

    cases = defaultdict(list)
    for event in events:
        cases[event.case_id].append(event)

    cycle_times       = []
    stage_durations   = defaultdict(list)
    actor_performance = defaultdict(list)
    sla_breaches      = Counter()
    invoice_amounts   = []
    case_details      = []

    for case_id, case_events in cases.items():
        case_events.sort(key=lambda e: e.timestamp)

        case_amount = next((e.amount for e in case_events if e.amount is not None), None)
        if case_amount:
            invoice_amounts.append(case_amount)

        cycle_time    = (case_events[-1].timestamp - case_events[0].timestamp).total_seconds() / 3600
        cycle_times.append(cycle_time)
        case_breached = False
        case_stages   = []

        for i in range(len(case_events) - 1):
            curr, nxt = case_events[i], case_events[i + 1]
            duration  = (nxt.timestamp - curr.timestamp).total_seconds() / 3600
            stage_durations[nxt.action].append(duration)
            actor_performance[nxt.actor].append(duration)
            case_stages.append({"action": nxt.action, "dur": round(duration, 2)})
            if nxt.action in SLA_RULES and duration > SLA_RULES[nxt.action]:
                sla_breaches[nxt.action] += 1
                case_breached = True

        case_details.append({
            "id":         str(case_id),
            "amount":     round(case_amount, 2) if case_amount else 0,
            "actor":      case_events[0].actor,
            "totalHours": round(cycle_time, 2),
            "breached":   case_breached,
            "stages":     case_stages,
        })

    avg_stage  = {s: round(sum(t) / len(t), 2) for s, t in stage_durations.items()}
    bottleneck = max(avg_stage, key=avg_stage.get) if avg_stage else None
    avg_cycle  = round(sum(cycle_times) / len(cycle_times), 2) if cycle_times else 0

    financial = {}
    if invoice_amounts:
        financial = {
            "total_value_processed": round(sum(invoice_amounts), 2),
            "average_invoice_value": round(statistics.mean(invoice_amounts), 2),
            "median_invoice_value":  round(statistics.median(invoice_amounts), 2),
            "min_invoice_value":     round(min(invoice_amounts), 2),
            "max_invoice_value":     round(max(invoice_amounts), 2),
            "invoice_value_std_dev": round(statistics.stdev(invoice_amounts), 2) if len(invoice_amounts) > 1 else 0,
        }

    result = {
        "total_cases":                   len(cases),
        "average_cycle_time_hours":      avg_cycle,
        "cycle_time_std_dev":            round(statistics.stdev(cycle_times), 2) if len(cycle_times) > 1 else 0,
        "average_stage_durations_hours": avg_stage,
        "bottleneck_stage":              bottleneck,
        "sla_breaches":                  dict(sla_breaches),
        "actor_performance_avg_hours":   {a: round(sum(t) / len(t), 2) for a, t in actor_performance.items()},
        "financial_metrics":             financial,
        "cases":                         case_details,
    }

    return result

# ── Cost calculation ─────────────────────────────────────────────────────────

def calculate_total_process_cost(metrics: Dict, cost_config: Dict) -> Dict:
    """Compute labor, SLA penalty, and cash-flow opportunity costs from process metrics."""
    total_cases     = metrics.get("total_cases", 0)
    avg_cycle       = metrics.get("average_cycle_time_hours", 0)
    total_sla       = sum(metrics.get("sla_breaches", {}).values())
    avg_invoice     = metrics.get("financial_metrics", {}).get("average_invoice_value", 0)
    hourly_rate     = cost_config.get("hourly_labor_cost",    DEFAULT_COSTS["hourly_labor_cost"])
    sla_penalty     = cost_config.get("sla_breach_penalty",   DEFAULT_COSTS["sla_breach_penalty"])
    cost_of_capital = cost_config.get("cost_of_capital_daily", DEFAULT_COSTS["cost_of_capital_daily"])

    total_labor_hrs = sum(metrics.get("average_stage_durations_hours", {}).values()) * total_cases
    labor_cost      = total_labor_hrs * hourly_rate
    sla_cost        = total_sla * sla_penalty
    # WIP-based cash flow cost: avg_invoice × cases × cycle_days × daily_rate
    cash_flow_cost  = avg_invoice * total_cases * (avg_cycle / 24) * cost_of_capital
    total_cost      = labor_cost + sla_cost + cash_flow_cost

    return {
        "labor_cost":                 round(labor_cost, 2),
        "sla_breach_cost":            round(sla_cost, 2),
        "cash_flow_opportunity_cost": round(cash_flow_cost, 2),
        "total_monthly_cost":         round(total_cost, 2),
        "cost_per_case":              round(total_cost / total_cases, 2) if total_cases else 0,
    }

# ── What-if simulation engine ────────────────────────────────────────────────

def simulate_add_approvers(metrics: Dict, num_approvers: int, cost_config: Dict) -> Dict:
    """
    M/M/c queuing theory model.
    Reduction factor = 1 - (1/(n+1))^QUEUING_THEORY_EXPONENT models diminishing returns.
    """
    stage_durations  = metrics.get("average_stage_durations_hours", {})
    bottleneck_dur   = stage_durations.get(metrics.get("bottleneck_stage"), 0)
    baseline_cycle   = metrics.get("average_cycle_time_hours", 0)
    baseline_sla     = sum(metrics.get("sla_breaches", {}).values())

    reduction_factor = 1 - (1 / (num_approvers + 1)) ** QUEUING_THEORY_EXPONENT
    bottleneck_cut   = bottleneck_dur * reduction_factor
    new_cycle        = baseline_cycle - bottleneck_cut
    cycle_impr       = (baseline_cycle - new_cycle) / baseline_cycle if baseline_cycle else 0

    new_metrics = {
        **metrics,
        "average_cycle_time_hours": new_cycle,
        "sla_breaches": {k: int(v * (1 - cycle_impr * SLA_BREACH_REDUCTION_FACTOR)) for k, v in metrics.get("sla_breaches", {}).items()},
    }
    new_sla      = max(int(baseline_sla * (1 - cycle_impr * SLA_BREACH_REDUCTION_FACTOR)), 0)
    hiring_cost  = num_approvers * cost_config.get("hourly_labor_cost", DEFAULT_COSTS["hourly_labor_cost"]) * MONTHLY_HOURS_PER_EMPLOYEE
    gross        = calculate_total_process_cost(metrics, cost_config)["total_monthly_cost"] - calculate_total_process_cost(new_metrics, cost_config)["total_monthly_cost"]
    net_savings  = gross - hiring_cost

    return {
        "new_cycle_time":             round(new_cycle, 2),
        "new_sla_breaches":           new_sla,
        "cycle_time_reduction_hours": round(bottleneck_cut, 2),
        "cycle_time_improvement_pct": round(cycle_impr * 100, 1),
        "sla_breach_reduction":       baseline_sla - new_sla,
        "monthly_savings_gross":      round(gross, 2),
        "monthly_hiring_cost":        round(hiring_cost, 2),
        "monthly_savings_net":        round(net_savings, 2),
        "annual_savings_net":         round(net_savings * 12, 2),
        "payback_months":             round(hiring_cost / max(net_savings, 1), 1) if net_savings > 0 else None,
    }


def simulate_auto_approval(metrics: Dict, threshold: float, cost_config: Dict) -> Dict:
    """
    Linear approximation of invoice distribution below threshold (capped at AUTO_APPROVAL_MAX_PCT).
    Eliminates approval stage time for qualifying invoices.
    """
    financial      = metrics.get("financial_metrics", {})
    avg_invoice    = financial.get("average_invoice_value", 100_000)
    std_dev        = financial.get("invoice_value_std_dev", 50_000)
    baseline_cycle = metrics.get("average_cycle_time_hours", 0)
    baseline_sla   = sum(metrics.get("sla_breaches", {}).values())
    approval_bk    = metrics.get("sla_breaches", {}).get("APPROVAL", 0)

    if avg_invoice > 0:
        pct = min(threshold / (avg_invoice * 2), AUTO_APPROVAL_MAX_PCT)
        if std_dev > 0 and std_dev < avg_invoice:
            pct = min(pct * (1 + (1 - std_dev / avg_invoice) * 0.2), AUTO_APPROVAL_MAX_PCT)
    else:
        pct = 0.3

    approval_dur = metrics.get("average_stage_durations_hours", {}).get("APPROVAL", 0)
    cycle_cut    = approval_dur * pct
    new_cycle    = baseline_cycle - cycle_cut
    new_sla      = baseline_sla - int(approval_bk * pct * AUTO_APPROVAL_SLA_IMPACT)
    new_metrics  = {
        **metrics,
        "average_cycle_time_hours": new_cycle,
        "sla_breaches": {**metrics.get("sla_breaches", {}), "APPROVAL": int(approval_bk * (1 - pct * AUTO_APPROVAL_SLA_IMPACT))},
    }

    gross       = calculate_total_process_cost(metrics, cost_config)["total_monthly_cost"] - calculate_total_process_cost(new_metrics, cost_config)["total_monthly_cost"]
    impl_monthly = AUTO_APPROVAL_SETUP_COST / 12
    net_savings  = gross - impl_monthly

    return {
        "new_cycle_time":              round(new_cycle, 2),
        "new_sla_breaches":            new_sla,
        "cycle_time_reduction_hours":  round(cycle_cut, 2),
        "cycle_time_improvement_pct":  round((cycle_cut / baseline_cycle) * 100, 1) if baseline_cycle else 0,
        "sla_breach_reduction":        baseline_sla - new_sla,
        "pct_invoices_auto_approved":  round(pct * 100, 1),
        "monthly_savings_gross":       round(gross, 2),
        "monthly_implementation_cost": round(impl_monthly, 2),
        "monthly_savings_net":         round(net_savings, 2),
        "annual_savings_net":          round(net_savings * 12, 2),
        "payback_months":              round(AUTO_APPROVAL_SETUP_COST / max(net_savings, 1), 1) if net_savings > 0 else None,
    }


def simulate_smart_routing(metrics: Dict, cost_config: Dict) -> Dict:
    """
    Little's Law optimization: SMART_ROUTING_IMPROVEMENT (25%) reduction
    in bottleneck wait time by matching tasks to available resources.
    """
    stage_durations = metrics.get("average_stage_durations_hours", {})
    bottleneck_dur  = stage_durations.get(metrics.get("bottleneck_stage"), 0)
    baseline_cycle  = metrics.get("average_cycle_time_hours", 0)
    baseline_sla    = sum(metrics.get("sla_breaches", {}).values())

    reduction       = bottleneck_dur * SMART_ROUTING_IMPROVEMENT
    new_cycle       = baseline_cycle - reduction
    impr_pct        = reduction / baseline_cycle if baseline_cycle else 0
    new_sla         = max(int(baseline_sla * (1 - impr_pct * SMART_ROUTING_SLA_FACTOR)), 0)
    new_metrics     = {
        **metrics,
        "average_cycle_time_hours": new_cycle,
        "sla_breaches": {k: int(v * (1 - impr_pct * SMART_ROUTING_SLA_FACTOR)) for k, v in metrics.get("sla_breaches", {}).items()},
    }

    gross       = calculate_total_process_cost(metrics, cost_config)["total_monthly_cost"] - calculate_total_process_cost(new_metrics, cost_config)["total_monthly_cost"]
    net_savings = gross - SMART_ROUTING_MONTHLY_COST

    return {
        "new_cycle_time":             round(new_cycle, 2),
        "new_sla_breaches":           new_sla,
        "cycle_time_reduction_hours": round(reduction, 2),
        "cycle_time_improvement_pct": round(impr_pct * 100, 1),
        "sla_breach_reduction":       baseline_sla - new_sla,
        "monthly_savings_gross":      round(gross, 2),
        "monthly_software_cost":      SMART_ROUTING_MONTHLY_COST,
        "monthly_savings_net":        round(net_savings, 2),
        "annual_savings_net":         round(net_savings * 12, 2),
        "payback_months":             0,
    }

# ── Efficiency score ─────────────────────────────────────────────────────────

def calculate_efficiency_score(metrics: Dict) -> int:
    """Score 0–100: penalties for SLA breach rate, excess cycle time, and bottleneck severity."""
    score       = 100
    breach_rate = sum(metrics["sla_breaches"].values()) / max(metrics["total_cases"], 1)
    score      -= min(breach_rate * 100, EFFICIENCY_MAX_SLA_PENALTY)

    avg_cycle = metrics["average_cycle_time_hours"]
    expected  = sum(SLA_RULES.values())
    if avg_cycle > expected:
        score -= min(((avg_cycle - expected) / expected) * 30, EFFICIENCY_MAX_CYCLE_PENALTY)

    stage_durs = metrics["average_stage_durations_hours"]
    if stage_durs:
        avg_stage = sum(stage_durs.values()) / len(stage_durs)
        if stage_durs.get(metrics["bottleneck_stage"], 0) > avg_stage * 1.5:
            score -= EFFICIENCY_BOTTLENECK_PENALTY

    return max(0, min(100, int(score)))

# ── LLM helpers ──────────────────────────────────────────────────────────────

def build_analysis_prompt(metrics: Dict, baseline_costs: Dict) -> str:
    """Shared prompt for all three analysis endpoints (Gemini, Ollama blocking, Ollama streaming)."""
    return f"""You are an AI Process Intelligence Advisor. Analyze the following process metrics and respond ONLY with a valid JSON object — no markdown, no backticks, no explanation outside the JSON.

Process Metrics:
{metrics}

Financial Context:
- Total value processed: ₹{metrics['financial_metrics'].get('total_value_processed', 0):,.0f}
- Average invoice: ₹{metrics['financial_metrics'].get('average_invoice_value', 0):,.0f}
- Current monthly cost: ₹{baseline_costs['total_monthly_cost']:,.0f}

Respond with exactly this JSON structure:
{{
  "risks": ["short risk point 1", "short risk point 2", "short risk point 3"],
  "bottlenecks": ["short bottleneck point 1", "short bottleneck point 2"],
  "sla_suggestions": ["short suggestion 1", "short suggestion 2", "short suggestion 3"],
  "staffing": ["short recommendation 1", "short recommendation 2"]
}}

Rules:
- Each point must be a single concise sentence (max 20 words)
- Maximum 3 points per section
- No nested objects, only flat string arrays
- Return ONLY the JSON object"""


def extract_json(text: str):
    """Extract the first valid JSON object from LLM output that may contain prose or markdown fences."""
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


_FALLBACK_INSIGHTS = {
    "risks":           ["AI response unavailable. Check API configuration."],
    "bottlenecks":     ["Could not extract structured insights."],
    "sla_suggestions": ["Retry after fixing the configuration issue."],
    "staffing":        [],
}


async def call_gemini(prompt: str) -> dict:
    """Call Gemini cloud API. Key is sent in headers, never embedded in the URL."""
    if not GEMINI_API_KEY:
        return {
            "risks":           ["GEMINI_API_KEY not configured."],
            "bottlenecks":     ["AI analysis unavailable without API key."],
            "sla_suggestions": ["Configure GEMINI_API_KEY for recommendations."],
            "staffing":        ["Set GEMINI_API_KEY to unlock staffing insights."],
        }
    headers = {"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(GEMINI_URL, json={"contents": [{"parts": [{"text": prompt}]}]}, headers=headers)
    if response.status_code != 200:
        raise HTTPException(status_code=500, detail=response.text)
    raw = response.json()["candidates"][0]["content"]["parts"][0]["text"]
    return extract_json(raw) or _FALLBACK_INSIGHTS


async def call_groq(prompt: str, model: str = None) -> dict:
    """Call Groq API (primary inference). Falls back to GROQ_MODEL_FAST on 429."""
    if not GROQ_API_KEY:
        raise Exception("GROQ_API_KEY not configured")
    used_model = model or GROQ_MODEL
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model":           used_model,
        "messages":        [{"role": "user", "content": prompt}],
        "temperature":     0.2,
        "max_tokens":      1000,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(GROQ_URL, json=payload, headers=headers)
    if response.status_code == 429 and used_model != GROQ_MODEL_FAST:
        return await call_groq(prompt, model=GROQ_MODEL_FAST)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Groq API error: {response.text}")
    content = response.json()["choices"][0]["message"]["content"]
    return extract_json(content) or _FALLBACK_INSIGHTS


async def call_groq_sop(prompt: str, scaffold: dict, metrics: dict) -> dict:
    """Call Groq for SOP prose generation. Uses json_object mode for reliable output."""
    if not GROQ_API_KEY:
        raise Exception("GROQ_API_KEY not configured")
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model":           GROQ_MODEL,
        "messages":        [{"role": "user", "content": prompt}],
        "temperature":     0.15,
        "max_tokens":      4000,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(GROQ_URL, json=payload, headers=headers)
    if response.status_code == 429:
        payload["model"] = GROQ_MODEL_FAST
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(GROQ_URL, json=payload, headers=headers)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Groq API error: {response.text}")
    content = response.json()["choices"][0]["message"]["content"]
    ai_prose = extract_json(content) or {}
    return merge_ai_prose_into_scaffold(scaffold, ai_prose, metrics)


async def stream_groq_chat(prompt: str, context: str):
    """Stream Groq chat response as SSE tokens for the Copilot."""
    if not GROQ_API_KEY:
        yield f"data: {json.dumps({'token': 'GROQ_API_KEY not configured. Please set it in your .env file.'})}\n\n"
        return
    sys_msg = (
        "You are FlowLens AI Copilot, an expert in business process intelligence and invoice workflow optimization. "
        f"Live process data: {context} "
        "Answer concisely using this data. Use ₹ for amounts. Be direct and actionable. Plain text only, no markdown headers."
    )
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model":       GROQ_MODEL,
        "messages":    [{"role": "system", "content": sys_msg}, {"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens":  600,
        "stream":      True,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", GROQ_URL, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    yield f"data: {json.dumps({'error': 'AI service temporarily unavailable. Please try again.'})}\n\n"
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        yield f"data: {json.dumps({'done': True})}\n\n"
                        break
                    try:
                        chunk   = json.loads(raw)
                        token   = chunk["choices"][0]["delta"].get("content", "")
                        if token:
                            yield f"data: {json.dumps({'token': token})}\n\n"
                    except (json.JSONDecodeError, KeyError):
                        continue
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        yield f"data: {json.dumps({'error': f'AI service temporarily unavailable. Retrying with fallback model.'})}\n\n"

async def read_and_parse_upload(file: UploadFile) -> List[Event]:
    """Read, size-check, extension-check, UTF-8 decode, and parse an uploaded log file."""
    ext = os.path.splitext(file.filename or "")[-1].lower()
    if ALLOWED_EXTENSIONS and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed. Accepted: {', '.join(ALLOWED_EXTENSIONS)}")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_FILE_SIZE // (1024*1024)}MB)")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded text.")
    events = parse_log(text)
    if not events:
        raise HTTPException(status_code=400, detail="No valid events found in file. Please check the log format.")
    return events

# ── Routes ───────────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """Analyze uploaded chat log — tries Groq first, falls back to Gemini."""
    start   = time.time()
    events  = await read_and_parse_upload(file)
    metrics = analyze_cases(events)
    costs   = calculate_total_process_cost(metrics, DEFAULT_COSTS)
    prompt  = build_analysis_prompt(metrics, costs)

    t_infer = time.time()
    try:
        ai_insights = await call_groq(prompt)
        model_used  = GROQ_MODEL
    except Exception:
        ai_insights = await call_gemini(prompt)
        model_used  = "gemini-2.5-flash"
    infer_time = time.time() - t_infer

    return {
        "metrics": metrics, "efficiency_score": calculate_efficiency_score(metrics),
        "ai_insights": ai_insights, "baseline_costs": costs, "inference_mode": "cloud",
        "performance": {"total_time_ms": round((time.time() - start) * 1000, 2), "inference_time_ms": round(infer_time * 1000, 2), "model_used": model_used},
    }


@app.post("/simulate")
async def simulate_whatif(request: WhatIfRequest):
    """Simulate what-if scenarios using mathematical process models."""
    scenario    = request.scenario
    metrics     = request.metrics
    params      = request.params
    cost_config = request.cost_config or DEFAULT_COSTS

    baseline_costs = calculate_total_process_cost(metrics, cost_config)
    result = {
        "scenario":     scenario,
        "baseline":     {"cycle_time": metrics.get("average_cycle_time_hours", 0), "sla_breaches": sum(metrics.get("sla_breaches", {}).values()), "monthly_cost": baseline_costs["total_monthly_cost"]},
        "predicted":    {}, "improvements": {}, "recommendations": [],
        "cost_breakdown": baseline_costs,
    }

    if scenario == "add_approver":
        n = params.get("additional_approvers", 1)
        if not isinstance(n, (int, float)):
            raise HTTPException(status_code=400, detail="additional_approvers must be a number")
        n = int(n)
        if not (MIN_ADDITIONAL_APPROVERS <= n <= MAX_ADDITIONAL_APPROVERS):
            raise HTTPException(status_code=400, detail=f"additional_approvers must be between {MIN_ADDITIONAL_APPROVERS} and {MAX_ADDITIONAL_APPROVERS}")
        sim     = simulate_add_approvers(metrics, n, cost_config)
        payback = f"{sim['payback_months']} months" if sim["payback_months"] is not None else "N/A (not cost-effective)"
        result["predicted"]    = {"cycle_time": sim["new_cycle_time"], "sla_breaches": sim["new_sla_breaches"], "monthly_savings_net": sim["monthly_savings_net"], "annual_savings_net": sim["annual_savings_net"]}
        result["improvements"] = {"cycle_time_reduction_pct": sim["cycle_time_improvement_pct"], "sla_breach_reduction": sim["sla_breach_reduction"], "payback_months": sim["payback_months"]}
        result["recommendations"] = [
            f"Hire {n} additional approver(s) to distribute {metrics.get('bottleneck_stage', 'bottleneck')} workload",
            "Implement load-based task assignment to balance queue times",
            f"Expected payback in {payback} with ₹{sim['monthly_savings_net']:,.0f}/month savings",
        ]
        result["calculation_details"] = {"model": "Queuing Theory (M/M/c)", "gross_savings": sim["monthly_savings_gross"], "hiring_cost": sim["monthly_hiring_cost"], "net_savings": sim["monthly_savings_net"]}

    elif scenario == "auto_approve":
        threshold = params.get("auto_approval_threshold", 50) * 1000
        if not isinstance(threshold, (int, float)):
            raise HTTPException(status_code=400, detail="auto_approval_threshold must be a number")
        if not (MIN_AUTO_APPROVAL_THRESHOLD <= threshold <= MAX_AUTO_APPROVAL_THRESHOLD * 1000):
            raise HTTPException(status_code=400, detail=f"auto_approval_threshold must be between {MIN_AUTO_APPROVAL_THRESHOLD / 1000}K and {MAX_AUTO_APPROVAL_THRESHOLD}K")
        sim     = simulate_auto_approval(metrics, threshold, cost_config)
        payback = f"{sim['payback_months']} months" if sim["payback_months"] is not None else "N/A"
        result["predicted"]    = {"cycle_time": sim["new_cycle_time"], "sla_breaches": sim["new_sla_breaches"], "monthly_savings_net": sim["monthly_savings_net"], "annual_savings_net": sim["annual_savings_net"]}
        result["improvements"] = {"cycle_time_reduction_pct": sim["cycle_time_improvement_pct"], "sla_breach_reduction": sim["sla_breach_reduction"], "pct_auto_approved": sim["pct_invoices_auto_approved"], "payback_months": sim["payback_months"]}
        result["recommendations"] = [
            f"Enable auto-approval for ~{sim['pct_invoices_auto_approved']:.0f}% of invoices under ₹{threshold:,.0f}",
            "Implement risk-based rules for trusted vendors and recurring transactions",
            f"Setup costs ₹{AUTO_APPROVAL_SETUP_COST:,} one-time, saves ₹{sim['monthly_savings_net']:,.0f}/month (payback: {payback})",
        ]
        result["calculation_details"] = {"model": "Distribution-based threshold estimation", "gross_savings": sim["monthly_savings_gross"], "implementation_cost_monthly": sim["monthly_implementation_cost"], "net_savings": sim["monthly_savings_net"]}

    elif scenario == "optimize_routing":
        sim = simulate_smart_routing(metrics, cost_config)
        result["predicted"]    = {"cycle_time": sim["new_cycle_time"], "sla_breaches": sim["new_sla_breaches"], "monthly_savings_net": sim["monthly_savings_net"], "annual_savings_net": sim["annual_savings_net"]}
        result["improvements"] = {"cycle_time_reduction_pct": sim["cycle_time_improvement_pct"], "sla_breach_reduction": sim["sla_breach_reduction"], "payback_months": sim["payback_months"]}
        result["recommendations"] = [
            "Route urgent/high-value invoices to fastest available approver",
            "Use ML to predict approver availability and response patterns",
            f"Software cost ₹{SMART_ROUTING_MONTHLY_COST:,}/month, saves ₹{sim['monthly_savings_net']:,.0f}/month net",
        ]
        result["calculation_details"] = {"model": "Little's Law optimization", "gross_savings": sim["monthly_savings_gross"], "software_cost": sim["monthly_software_cost"], "net_savings": sim["monthly_savings_net"]}

    elif scenario == "custom":
        pct = params.get("target_reduction", 20)
        if not isinstance(pct, (int, float)):
            raise HTTPException(status_code=400, detail="target_reduction must be a number")
        if not (MIN_TARGET_REDUCTION_PCT <= pct <= MAX_TARGET_REDUCTION_PCT):
            raise HTTPException(status_code=400, detail=f"target_reduction must be between {MIN_TARGET_REDUCTION_PCT}% and {MAX_TARGET_REDUCTION_PCT}%")
        factor       = pct / 100
        new_cycle    = metrics.get("average_cycle_time_hours", 0) * (1 - factor)
        baseline_sla = sum(metrics.get("sla_breaches", {}).values())
        new_sla      = max(int(baseline_sla * (1 - factor)), 0)
        new_metrics  = {**metrics, "average_cycle_time_hours": new_cycle, "sla_breaches": {k: int(v * (1 - factor)) for k, v in metrics.get("sla_breaches", {}).items()}}
        savings      = baseline_costs["total_monthly_cost"] - calculate_total_process_cost(new_metrics, cost_config)["total_monthly_cost"]
        result["predicted"]    = {"cycle_time": round(new_cycle, 2), "sla_breaches": new_sla, "monthly_savings_net": round(savings, 2), "annual_savings_net": round(savings * 12, 2)}
        result["improvements"] = {"cycle_time_reduction_pct": round(factor * 100, 1), "sla_breach_reduction": baseline_sla - new_sla}
        result["recommendations"] = [
            "Consider combining multiple optimization strategies for best results",
            "Start with quick wins (auto-approval, routing) before hiring",
            f"Target improvement of {pct:.0f}% could save ₹{savings:,.0f}/month",
        ]

    else:  # baseline
        result["predicted"]    = result["baseline"].copy()
        result["improvements"] = {"cycle_time_reduction_pct": 0, "sla_breach_reduction": 0}
        result["recommendations"] = ["This is your current baseline — select an optimization to see predictions"]

    return result

# ── Request models ───────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    prompt: str
    context: str = ""


class SOPRequest(BaseModel):
    context: str
    metrics: Optional[Dict] = None

# ── SOP scaffold builder ─────────────────────────────────────────────────────
# Scaffold-first approach: all structural/numeric facts are computed from
# metrics here in Python. The AI only writes prose (actions, decisions,
# exceptions). This guarantees correctness regardless of model quality.

# Human-readable stage display names for the SOP document
STAGE_DISPLAY = {
    "INVOICE_SENT":     "Invoice Receipt & Registration",
    "APPROVAL":         "Invoice Verification & Approval",
    "PAYMENT":          "Payment Processing & Disbursement",
    "REFUND_INITIATED": "Refund Initiation",
    "REFUND_COMPLETED": "Refund Completion & Reconciliation",
}

# Role titles derived from stage responsibilities — used instead of personal names
STAGE_ROLE = {
    "INVOICE_SENT":     "Accounts Receivable Clerk",
    "APPROVAL":         "Approving Authority",
    "PAYMENT":          "Accounts Payable Officer",
    "REFUND_INITIATED": "Finance Officer",
    "REFUND_COMPLETED": "Finance Manager",
}

# Standard inputs/outputs per stage — realistic document names
STAGE_INPUTS = {
    "INVOICE_SENT":     "Vendor invoice, Purchase order (PO) reference, Delivery confirmation",
    "APPROVAL":         "Received invoice, PO copy, Goods receipt note (GRN), Vendor master record",
    "PAYMENT":          "Approved invoice, Vendor bank details, Authorised payment voucher",
    "REFUND_INITIATED": "Original payment record, Refund request form, Approval authorisation",
    "REFUND_COMPLETED": "Initiated refund record, Bank transaction confirmation, Customer communication log",
}
STAGE_OUTPUTS = {
    "INVOICE_SENT":     "Registered invoice (with reference number), System entry, Acknowledgement to vendor",
    "APPROVAL":         "Approved/rejected invoice, Approval log entry, Notification to Accounts Payable",
    "PAYMENT":          "Payment confirmation advice, Updated AP ledger, Bank transaction record",
    "REFUND_INITIATED": "Refund request record, Customer/vendor notification, Updated dispute log",
    "REFUND_COMPLETED": "Refund completion confirmation, Reconciled ledger entry, Closed dispute record",
}

# Acceptance criteria per stage — what must be true for the step to be complete
STAGE_ACCEPTANCE = {
    "INVOICE_SENT":     "Invoice is logged in the system with a unique reference number and all mandatory fields are populated.",
    "APPROVAL":         "Invoice details match the PO within acceptable tolerance; approval is recorded with authoriser name and timestamp.",
    "PAYMENT":          "Payment is initiated, transaction reference captured, and vendor notified within SLA.",
    "REFUND_INITIATED": "Refund is logged with reason code, approval obtained, and vendor/customer notified.",
    "REFUND_COMPLETED": "Refund is reflected in bank statement, ledger is reconciled, and case is closed in the system.",
}


def derive_role_title(actor_name: str, stage_actor_map: Dict) -> str:
    """Map a personal name to a professional role title based on stages they handle."""
    actor_upper = actor_name.upper()
    # Find all stages this actor handles
    stages_handled = [s for s, a in stage_actor_map.items() if a.upper() == actor_upper]
    # Return the most senior role title for their stages
    role_priority = ["APPROVAL", "PAYMENT", "REFUND_COMPLETED", "REFUND_INITIATED", "INVOICE_SENT"]
    for s in role_priority:
        if s in stages_handled:
            return STAGE_ROLE.get(s, "Finance Officer")
    return "Finance Officer"


def build_sop_scaffold(metrics: Dict) -> Dict:
    """Build the deterministic, data-driven parts of the SOP from metrics."""
    today     = date.today().isoformat()
    next_year = date.today().replace(year=date.today().year + 1).isoformat()

    stage_durations = metrics.get("average_stage_durations_hours", {})
    sla_breaches    = metrics.get("sla_breaches", {})
    actor_perf      = metrics.get("actor_performance_avg_hours", {})
    bottleneck      = metrics.get("bottleneck_stage", "")
    avg_cycle       = metrics.get("average_cycle_time_hours", 0)
    total_breaches  = sum(sla_breaches.values())
    total_cases     = metrics.get("total_cases", 0)

    # Determine which actor most frequently handled each stage
    cases = metrics.get("cases", [])
    stage_actor_count: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for case in cases:
        for stage_event in case.get("stages", []):
            stage_actor_count[stage_event["action"]][case["actor"]] += 1
    stage_actor_map: Dict[str, str] = {
        stage: max(counts, key=counts.get)
        for stage, counts in stage_actor_count.items()
    }
    if not stage_actor_map:
        primary = min(actor_perf, key=actor_perf.get) if actor_perf else "Operations"
        stage_actor_map = {s: primary for s in stage_durations}

    # Ordered stages (logical process flow)
    stage_order = ["INVOICE_SENT", "APPROVAL", "PAYMENT", "REFUND_INITIATED", "REFUND_COMPLETED"]
    ordered_stages = [s for s in stage_order if s in stage_durations]
    for s in stage_durations:
        if s not in ordered_stages:
            ordered_stages.append(s)

    # Build steps scaffold
    steps_scaffold = []
    for i, stage in enumerate(ordered_stages, 1):
        avg_dur     = stage_durations[stage]
        sla_h       = SLA_RULES.get(stage, round(avg_dur * 1.5, 1))
        actor_name  = stage_actor_map.get(stage, list(actor_perf.keys())[0] if actor_perf else "Operations")
        role_title  = STAGE_ROLE.get(stage, "Finance Officer")
        display     = STAGE_DISPLAY.get(stage, stage.replace("_", " ").title())
        breaches    = sla_breaches.get(stage, 0)
        breach_pct  = round((breaches / total_cases * 100), 0) if total_cases else 0

        steps_scaffold.append({
            "step":         i,
            "stage":        stage,
            "display":      display,
            "role_title":   role_title,
            "actor_name":   actor_name,
            "sla":          f"{sla_h}h",
            "avg_dur":      avg_dur,
            "inputs":       STAGE_INPUTS.get(stage, "Documents and data from previous stage"),
            "outputs":      STAGE_OUTPUTS.get(stage, "Updated records and status confirmation"),
            "acceptance":   STAGE_ACCEPTANCE.get(stage, "Stage completed and documented in system."),
            "breaches":     breaches,
            "breach_pct":   breach_pct,
            "sla_h":        sla_h,
        })

    # Roles — one per unique actor, with professional title
    roles_scaffold = []
    seen_actors = set()
    for actor_name, avg_h in actor_perf.items():
        if actor_name in seen_actors:
            continue
        seen_actors.add(actor_name)
        role_title = derive_role_title(actor_name, stage_actor_map)
        roles_scaffold.append({
            "actor_name": actor_name,
            "role_title": role_title,
            "avg_hours":  avg_h,
        })

    # KPIs — computed directly from data
    bot_dur = stage_durations.get(bottleneck, avg_cycle)
    bot_display = STAGE_DISPLAY.get(bottleneck, bottleneck.replace("_", " ").title())
    kpis_scaffold = [
        {
            "metric":      "Average Invoice Cycle Time",
            "current":     f"{avg_cycle}h",
            "target":      f"{round(avg_cycle * 0.80, 2)}h",
            "measurement": "Time from invoice receipt to payment completion, averaged across all cases",
        },
        {
            "metric":      "SLA Compliance Rate",
            "current":     f"{round(100 - (total_breaches / total_cases * 100), 1) if total_cases else 100}%",
            "target":      "100%",
            "measurement": "Percentage of invoices processed within SLA across all stages",
        },
        {
            "metric":      f"Bottleneck Resolution — {bot_display}",
            "current":     f"{bot_dur}h avg",
            "target":      f"{round(bot_dur * 0.75, 2)}h avg",
            "measurement": f"Average processing time for the {bot_display} stage per invoice",
        },
    ]

    return {
        "today":           today,
        "next_year":       next_year,
        "steps_scaffold":  steps_scaffold,
        "roles_scaffold":  roles_scaffold,
        "kpis_scaffold":   kpis_scaffold,
        "actor_perf":      actor_perf,
        "stage_actor_map": stage_actor_map,
        "bottleneck":      bottleneck,
        "avg_cycle":       avg_cycle,
        "total_breaches":  total_breaches,
        "total_cases":     total_cases,
        "stage_durations": stage_durations,
        "ordered_stages":  ordered_stages,
    }


def merge_ai_prose_into_scaffold(scaffold: Dict, ai_prose: Dict, metrics: Dict) -> Dict:
    """Merge AI prose into the data scaffold. Scaffold values always win for structural facts."""
    today      = scaffold["today"]
    next_year  = scaffold["next_year"]
    actor_perf = scaffold["actor_perf"]

    ai_steps_by_stage = {}
    for s in ai_prose.get("steps", []):
        key = str(s.get("stage", "")).upper().strip()
        if key not in ai_steps_by_stage:
            ai_steps_by_stage[key] = s

    final_steps = []
    for sc in scaffold["steps_scaffold"]:
        stage_key = sc["stage"]
        ai_s      = ai_steps_by_stage.get(stage_key, {})
        final_steps.append({
            "step":           sc["step"],
            "stage":          sc["display"],     # Human-readable display name
            "role_title":     sc["role_title"],  # Professional title, not personal name
            "actor":          sc["actor_name"],  # Personal name kept for reference only
            "sla":            sc["sla"],
            "inputs":         sc["inputs"],
            "outputs":        sc["outputs"],
            "acceptance":     sc["acceptance"],
            "action":         ai_s.get("action") or _default_action(sc),
            "decision_point": ai_s.get("decision_point") or _default_decision(sc),
            "escalation":     ai_s.get("escalation") or f"If not completed within {sc['sla']}, notify the Finance Manager immediately and log the delay in the issue tracker.",
        })

    ai_roles_by_name = {r.get("name", "").upper(): r for r in ai_prose.get("roles", [])}
    final_roles = []
    for sc in scaffold["roles_scaffold"]:
        ai_r = ai_roles_by_name.get(sc["actor_name"].upper(), {})
        final_roles.append({
            "name":           sc["role_title"],
            "actor":          sc["actor_name"],
            "responsibility": ai_r.get("responsibility") or f"Responsible for all {sc['role_title'].lower()} tasks within this process. Average handling time: {sc['avg_hours']}h.",
        })

    return {
        "title":           ai_prose.get("title")        or "Invoice Processing Standard Operating Procedure",
        "doc_id":          ai_prose.get("doc_id")        or "SOP-FIN-INV-001",
        "version":         "v1.0",
        "effective_date":  today,
        "review_date":     next_year,
        "document_owner":  "Finance Manager",
        "approved_by":     ai_prose.get("approved_by")  or "Head of Finance",
        "objective":       ai_prose.get("objective")    or "To standardise the end-to-end invoice processing workflow, ensuring all invoices are verified, approved, and paid within defined SLA targets.",
        "scope":           ai_prose.get("scope")        or "All invoices received from vendors and customers processed through the finance system.",
        "out_of_scope":    ai_prose.get("out_of_scope") or "Petty cash transactions, inter-company journal entries, and invoices processed outside the finance system.",
        "prerequisites":   ai_prose.get("prerequisites") or [
            "Finance system (ERP/accounting software) is operational and accessible",
            "All vendors are registered with verified bank details in the system",
            "Approval authority matrix is documented and up to date",
            "Staff have completed mandatory finance process training",
        ],
        "definitions":     ai_prose.get("definitions") or [
            {"term": "Invoice", "definition": "A commercial document issued by a vendor requesting payment for goods or services delivered."},
            {"term": "SLA", "definition": "Service Level Agreement — the maximum allowed processing time for each stage of the invoice workflow."},
            {"term": "Approving Authority", "definition": "The designated staff member with authorisation to approve invoices up to their delegated financial limit."},
            {"term": "GRN", "definition": "Goods Receipt Note — a document confirming that goods or services have been received as per the purchase order."},
        ],
        "roles":           final_roles,
        "steps":           final_steps,
        "exceptions":      ai_prose.get("exceptions") or _default_exceptions(scaffold),
        "kpis":            scaffold["kpis_scaffold"],
        "version_history": [{"version": "v1.0", "date": today, "author": "FlowLens AI", "changes": "Initial SOP auto-generated from process mining data"}],
    }


def _default_action(sc: Dict) -> str:
    stage = sc["stage"]
    role  = sc["role_title"]
    sla   = sc["sla"]
    defaults = {
        "INVOICE_SENT":     f"Receive the vendor invoice via email or the invoice portal. Verify that the invoice contains all mandatory fields: vendor name, invoice number, date, line items, GST/tax details, and bank account. Register the invoice in the ERP system, assign a unique reference number, and set the status to 'Received'. Send an acknowledgement to the vendor within 2 hours of receipt.",
        "APPROVAL":         f"Retrieve the invoice from the approval queue. Perform a 3-way match: verify invoice line items against the corresponding Purchase Order and Goods Receipt Note. Check that the invoice amount is within the approved budget and that the vendor is on the approved vendor list. Record the approval or rejection decision in the system with a timestamp and reason. Notify the Accounts Payable Officer of the outcome within the {sla} SLA window.",
        "PAYMENT":          f"Retrieve the approved invoice from the payment queue. Verify vendor bank details against the master vendor record — do not rely on bank details provided on the invoice itself. Raise a payment voucher in the accounting system and obtain dual authorisation for amounts above the payment threshold. Initiate the bank transfer, capture the transaction reference number, and update the invoice status to 'Paid'. Send a payment advice to the vendor.",
        "REFUND_INITIATED": f"Review the refund request for completeness and validity. Obtain written approval from the Finance Manager for all refunds above the standard threshold. Create a refund record in the system, document the reason code, and notify the vendor or customer of the refund timeline. Update the original invoice status to 'Refund Initiated'.",
        "REFUND_COMPLETED": f"Confirm that the refund has been credited to the vendor or customer account by cross-checking the bank statement. Update the refund record status to 'Completed' in the finance system. Reconcile the refund entry against the general ledger. Close the associated dispute or complaint record and archive all supporting documentation.",
    }
    return defaults.get(stage, f"Complete all required tasks for the {sc['display']} stage. Verify all inputs are correct, update the system accordingly, and confirm completion within the {sla} SLA window.")


def _default_decision(sc: Dict) -> str:
    stage = sc["stage"]
    defaults = {
        "INVOICE_SENT":     "Does the invoice contain all mandatory fields and match a registered vendor in the system?",
        "APPROVAL":         "Do the invoice amount, line items, and vendor details match the PO and GRN within acceptable tolerance (≤5% variance)?",
        "PAYMENT":          "Have dual authorisations been obtained and do the vendor bank details match the master record?",
        "REFUND_INITIATED": "Is the refund request valid, fully documented, and approved by the Finance Manager?",
        "REFUND_COMPLETED": "Has the refund been confirmed in the bank statement and the ledger reconciled successfully?",
    }
    return defaults.get(stage, f"Have all acceptance criteria for the {sc['display']} stage been met and documented?")


def _default_exceptions(scaffold: Dict) -> List[Dict]:
    bottleneck = scaffold.get("bottleneck", "PAYMENT")
    bot_display = STAGE_DISPLAY.get(bottleneck, bottleneck.replace("_", " ").title())
    return [
        {"scenario": "Invoice amount does not match Purchase Order", "handling": "Place the invoice on hold. Contact the vendor requesting a corrected invoice or credit note. Do not process payment until discrepancy is resolved. Log in dispute tracker and notify the Approving Authority."},
        {"scenario": f"SLA breach in {bot_display} stage", "handling": f"Immediately notify the Finance Manager via email and the issue tracking system. Document the reason for the delay. If unresolved within 1 hour of SLA breach, escalate to the Head of Finance."},
        {"scenario": "Duplicate invoice detected", "handling": "Reject the duplicate invoice and notify the vendor with the original invoice reference number. Archive the duplicate with a 'Rejected — Duplicate' status. No payment should be processed."},
        {"scenario": "Vendor bank details mismatch", "handling": "Immediately halt payment processing. Verify the correct bank details directly with the vendor via a registered phone number (not email). Document all verification steps. Do not update bank details until written confirmation is received from the vendor."},
    ]




class ChatGeminiRequest(BaseModel):
    prompt: str
    context: str = ""
    history: list = []


class SOPGeminiRequest(BaseModel):
    context: str
    metrics: Optional[Dict] = None


@app.post("/sop-gemini")
async def sop_gemini(req: SOPGeminiRequest):
    """Gemini SOP generation — scaffold-first, AI writes professional prose only."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured on server.")
    if not req.metrics:
        raise HTTPException(status_code=400, detail="metrics field required for SOP generation")

    scaffold = build_sop_scaffold(req.metrics)

    stage_lines = "\n".join(
        f"  Step {s['step']}: {s['display']} | Role: {s['role_title']} | SLA: {s['sla']} | Avg actual: {s['avg_dur']}h | Breaches: {s['breaches']} of {scaffold['total_cases']} invoices ({s['breach_pct']}%)"
        for s in scaffold["steps_scaffold"]
    )
    role_lines = "\n".join(
        f"  {sc['role_title']} — handled by {sc['actor_name']}, avg response {sc['avg_hours']}h"
        for sc in scaffold["roles_scaffold"]
    )
    stage_keys = ", ".join(s["stage"] for s in scaffold["steps_scaffold"])

    prompt = f"""You are a senior finance process consultant writing a corporate Standard Operating Procedure (SOP) document.

PROCESS ANALYTICS DATA:
{req.context}

PRE-DEFINED PROCESS STAGES (write prose for every one, using exact stage keys listed):
{stage_lines}

ROLES:
{role_lines}

YOUR TASK: Write ONLY the prose fields. Structure (stages, SLAs, actors, KPIs, version history) is already set by the system.

MANDATORY STYLE — this must read as a real corporate finance SOP:
1. Use imperative voice: "Verify...", "Log...", "Confirm...", "Escalate...", "Reconcile..."  
2. Refer to ROLE TITLES (Approving Authority, Finance Officer, Accounts Payable Officer), never personal names
3. Each action field: 3–4 sentences covering (a) what to do, (b) what system/tool to use, (c) what to verify/check, (d) what to record/update
4. Decision points: yes/no questions with concrete measurable criteria — e.g. "Does invoice match PO within 5% tolerance and is the vendor on the approved vendor list?"
5. Escalations: named contact + timeframe — e.g. "If unresolved within 30 minutes of SLA breach, notify Finance Manager by email and log in the incident tracker"
6. Exceptions: 4 realistic AP scenarios (PO mismatch, duplicate invoice, bank detail fraud, SLA breach). Each handling must have a concrete 3-step procedure.

The "steps" array must have EXACTLY one entry per stage key: {stage_keys}
Use those exact keys in the "stage" field of each step."""

    def str_arr():
        return {"type": "ARRAY", "items": {"type": "STRING"}}
    def obj_arr(*fields):
        return {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {f: {"type": "STRING"} for f in fields}}}

    prose_schema = {
        "type": "OBJECT",
        "properties": {
            "title":          {"type": "STRING"},
            "doc_id":         {"type": "STRING"},
            "approved_by":    {"type": "STRING"},
            "objective":      {"type": "STRING"},
            "scope":          {"type": "STRING"},
            "out_of_scope":   {"type": "STRING"},
            "prerequisites":  str_arr(),
            "roles":          obj_arr("name", "responsibility"),
            "steps":          obj_arr("stage", "action", "decision_point", "escalation"),
            "exceptions":     obj_arr("scenario", "handling"),
        },
        "required": ["title", "objective", "scope", "out_of_scope", "prerequisites", "roles", "steps", "exceptions"],
    }

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.15, "maxOutputTokens": 8192, "responseMimeType": "application/json", "responseSchema": prose_schema},
    }
    headers = {"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY}

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(GEMINI_URL, json=payload, headers=headers)
        result    = response.json()
        if "error" in result:
            raise HTTPException(status_code=502, detail=result["error"].get("message", "Gemini error"))
        candidate     = result["candidates"][0]
        finish_reason = candidate.get("finishReason", "")
        if finish_reason == "MAX_TOKENS":
            raise HTTPException(status_code=500, detail="Response cut off (MAX_TOKENS).")
        if finish_reason not in ("STOP", ""):
            raise HTTPException(status_code=500, detail=f"Unexpected finish reason: {finish_reason}")
        ai_prose = extract_json(candidate["content"]["parts"][0]["text"]) or {}
        sop = merge_ai_prose_into_scaffold(scaffold, ai_prose, req.metrics)
        return {"sop": sop}
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach Gemini API: {e}")


@app.post("/chat-gemini")
async def chat_gemini(req: ChatGeminiRequest):
    """Gemini copilot chat proxy — keeps API key server-side."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured on server.")

    sys_text = (
        "You are FlowLens AI Copilot, an expert in business process intelligence and invoice workflow optimization.\n"
        f"Live data: {req.context}\n"
        "Answer concisely and specifically using this data. Use \u20b9 for amounts. Be direct and actionable."
    )
    first_user = next((i for i, m in enumerate(req.history) if m.get("role") == "user"), None)
    contents   = req.history[first_user:] if first_user is not None else [{"role": "user", "parts": [{"text": req.prompt}]}]
    headers    = {"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(GEMINI_URL, json={"system_instruction": {"parts": [{"text": sys_text}]}, "contents": contents}, headers=headers)
        result = response.json()
        if "error" in result:
            raise HTTPException(status_code=502, detail=result["error"].get("message", "Gemini error"))
        return {"reply": result["candidates"][0]["content"]["parts"][0]["text"]}
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach Gemini API: {e}")


# ── Groq inference endpoints (primary) ───────────────────────────────────────

class ChatGroqRequest(BaseModel):
    prompt: str
    context: str = ""


class SOPGroqRequest(BaseModel):
    context: str
    metrics: Optional[Dict] = None


@app.post("/chat-groq")
async def chat_groq(req: ChatGroqRequest):
    """Groq copilot chat — streaming SSE, falls back to Gemini if Groq unavailable."""
    if not GROQ_API_KEY:
        # Fallback to Gemini non-streaming
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=503, detail="No AI API keys configured.")
        gemini_req = ChatGeminiRequest(prompt=req.prompt, context=req.context)
        return await chat_gemini(gemini_req)

    async def generate():
        async for chunk in stream_groq_chat(req.prompt, req.context):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/sop-groq")
async def sop_groq(req: SOPGroqRequest):
    """Groq SOP generation — scaffold-first, falls back to Gemini if Groq unavailable."""
    if not req.metrics:
        raise HTTPException(status_code=400, detail="metrics field required for SOP generation")

    scaffold = build_sop_scaffold(req.metrics)

    stage_lines = "\n".join(
        f"  Step {s['step']}: {s['display']} | Role: {s['role_title']} | SLA: {s['sla']} | Avg actual: {s['avg_dur']}h | Breaches: {s['breaches']} of {scaffold['total_cases']} invoices ({s['breach_pct']}%)"
        for s in scaffold["steps_scaffold"]
    )
    role_lines = "\n".join(
        f"  {sc['role_title']} — handled by {sc['actor_name']}, avg response {sc['avg_hours']}h"
        for sc in scaffold["roles_scaffold"]
    )
    stage_keys = ", ".join(s["stage"] for s in scaffold["steps_scaffold"])

    prompt = f"""You are a senior finance process consultant writing a corporate Standard Operating Procedure (SOP).

PROCESS ANALYTICS DATA:
{req.context}

PRE-DEFINED PROCESS STAGES (write prose for every one, using exact stage keys):
{stage_lines}

ROLES:
{role_lines}

YOUR TASK: Write ONLY the prose fields as a JSON object. Do not invent stages or roles.

MANDATORY STYLE:
1. Imperative voice: "Verify...", "Log...", "Confirm...", "Escalate...", "Reconcile..."
2. Refer to ROLE TITLES only, never personal names
3. Each action field: 3-4 sentences covering what to do, what system to use, what to verify, what to record
4. Decision points: yes/no questions with measurable criteria
5. Escalations: named contact + timeframe
6. Exceptions: 4 realistic AP scenarios with concrete 3-step handling procedures

Return ONLY a JSON object with these exact keys:
title, doc_id, approved_by, objective, scope, out_of_scope, prerequisites (array of strings),
roles (array of {{name, responsibility}}),
steps (array of {{stage, action, decision_point, escalation}} — EXACTLY one per stage key: {stage_keys}),
exceptions (array of {{scenario, handling}})"""

    if GROQ_API_KEY:
        try:
            sop = await call_groq_sop(prompt, scaffold, req.metrics)
            return {"sop": sop}
        except Exception:
            pass  # fall through to Gemini

    # Gemini fallback
    gemini_req = SOPGeminiRequest(context=req.context, metrics=req.metrics)
    return await sop_gemini(gemini_req)