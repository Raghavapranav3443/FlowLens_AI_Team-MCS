<div align="center">

# 🌊 FlowLens AI
**Process Intelligence for Teams that Run on WhatsApp**

[![Frontend](https://img.shields.io/badge/Frontend-React.js-blue?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Backend](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![AI Engine](https://img.shields.io/badge/AI_Engine-Groq_|_Llama_3.3_70B-f55036?style=for-the-badge)](https://groq.com/)
[![AI Fallback](https://img.shields.io/badge/Fallback-Gemini_2.5_Flash-1a73e8?style=for-the-badge&logo=googlebard)](https://aistudio.google.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org/)
[![Hackathon](https://img.shields.io/badge/Hackathon-HACKFUSION--2K26-FFb60b?style=for-the-badge)](https://jntuh.ac.in)

</div>

---

## 🚀 The Problem

Indian SMEs lose an estimated **₹2.3 lakh crore** annually to delayed invoice approvals and payment bottlenecks. 
And almost all of these processes are manually tracked and chased over **WhatsApp**. 

There is zero visibility into where delays happen, who the bottlenecks are, and what these inefficiencies cost the business every month.

## 💡 The Solution

**FlowLens AI** turns the chaos of WhatsApp group chats into a real-time operational dashboard. 
Export your team's discussion as a `.txt` file, drop it into FlowLens, and our process mining engine maps it instantly.

- ⏱ **Cycle Times & SLA Tracking:** Identify exactly which stages breach their SLAs.
- 💰 **Cost of Delay:** Translate time lost directly into real-time Rupee loss.
- 🤖 **Instant Narrative Insights:** Powered by Groq's blindingly fast **Llama 3.3 70B**, get human-readable insights mapping out precisely where your process is failing and why.
- 🔮 **What-If Simulator:** See the exact ROI and time savings of auto-approval or smart-routing before you implement it.
- 📄 **One-Click SOP Export:** Auto-generate a beautiful, structured Standard Operating Procedure PDF derived straight from your team's historical data ground truth.
- 💬 **AI Copilot:** Chat with your process data. Ask: *"Why is the payment stage delayed?"*

---

## 🛠 Tech Stack & Architecture

- **Frontend:** React.js, TailwindCSS (Responsive UI, Interactive Dashboards, Real-time Streaming Chat)
- **Backend:** Python, FastAPI (Process mining engine, API routing, Data parsing)
- **Primary AI Engine:** [Groq API](https://groq.com/) utilizing `llama-3.3-70b-versatile` for sub-second structured JSON insights and narrative generation.
- **Fallback AI Engine:** Google Gemini `gemini-2.5-flash` for automatic fallback on rate limits.
- **Data Privacy Details:** Data is processed securely in memory without local database dependencies.

---

## ⚙️ Setup & Installation

Follow these steps to run **FlowLens AI** locally.

### 1. Prerequisites
- **Node.js** (v18+)
- **Python** (3.10+)
- **Groq API Key** (Get free tier at [console.groq.com](https://console.groq.com))
- **Gemini API Key** (Get free tier at [Google AI Studio](https://aistudio.google.com/))

### 2. Clone the Repository
```bash
git clone https://github.com/your-username/FlowLens_AI.git
cd FlowLens_AI
```

### 3. Environment Variables
Create a `.env` file in the root directory (you can copy from `env.example`):
```env
# AI API Keys
GROQ_API_KEY="gsk_your_groq_key_here"
GEMINI_API_KEY="AIza_your_gemini_key_here"
```
### 4. Setup :
Setup is fully done automatically by the start.py file! Just open terminal and launch the file:
```bash
python start.py
```
Or for manual setup follow these steps: 
## Backend Setup
Open a terminal and start the backend service:
```bash
cd backend

# Create a virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate

# Install dependencies
pip install -r ../requirements.txt

# Start the FastAPI server
uvicorn main:app --reload
```
The backend will run at: `http://localhost:8000`

## 5. Frontend Setup
Open a second terminal and start the React app:
```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm start
```
The application will launch on your browser at: `http://localhost:3000`

---

## 📊 How to Demo FlowLens AI

1. **Load Data:** Navigate to `http://localhost:3000`. Click **Analyse my process**.
2. **Use Sample Data:** For the fastest experience, click **"⚡ Skip upload — run with sample data"**. (If you wish to upload, use the provided `sample_invoice_log.txt`).
3. **Review the Dashboard:** Look at the visual Efficiency Score, the Process Diagram mapping the exact states (APPROVAL, PAYMENT, etc.), and read the AI Insights generated instantly by Groq.
4. **Run What-If Simulation:** Click on the "What-If Simulator" and visualize the monthly savings when implementing Auto-Approvals.
5. **Generate SOP:** Go to the SOP page, hit **"Generate Implementation Plan"** to watch the AI build out process steps, then download the structured PDF.
6. **Copilot Queries:** Jump into Copilot and ask: *"What's our biggest bottleneck right now?"*

---

## 👩‍💻 Developed For
Built competitively for **HACKFUSION-2K26** (Vibecoding Track) at JNTU, Hyderabad.

<div align="center">
<i>Transforming Invoice Chaos into Actionable Process Intelligence.</i>
</div>
