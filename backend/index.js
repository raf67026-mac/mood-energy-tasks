require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();


app.use(cors());
app.use(express.json());


const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:4200";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function createMailer() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: mustEnv("SMTP_USER"),
      pass: mustEnv("SMTP_PASS"),
    },
  });
}

function normalizeEnergy(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "LOW" || v === "MEDIUM" || v === "HIGH") return v;
  return "MEDIUM";
}

function normalizeStatus(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "PENDING" || v === "IN_PROGRESS" || v === "COMPLETED") return v;
  return null;
}


function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ message: "Missing auth token" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}


app.get("/", (req, res) => {
  res.send("API is running 🚀");
});




app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Missing data" });

    const normalizedEmail = String(email).trim().toLowerCase();

    const exists = await prisma.user.findFirst({ where: { email: normalizedEmail } });
    if (exists) return res.status(409).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
      data: { email: normalizedEmail, password: hashed },
      select: { id: true, email: true },
    });

    return res.json({ message: "Registered", user });
  } catch (e) {
    console.error("REGISTER_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});


app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Missing data" });

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await prisma.user.findFirst({ where: { email: normalizedEmail } });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token });
  } catch (e) {
    console.error("LOGIN_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});




app.get("/users/me", authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, mood: true, energy: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ user });
  } catch (e) {
    console.error("GET_ME_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});


app.post("/users/me", authRequired, async (req, res) => {
  try {
    const { email, password, mood, energy } = req.body || {};

    const data = {};

    if (typeof email === "string" && email.trim()) {
      data.email = email.trim().toLowerCase();
    }

    if (typeof password === "string" && password.trim().length >= 6) {
      data.password = await bcrypt.hash(password.trim(), 10);
    }

    if (typeof mood === "string" && mood.trim()) data.mood = mood.trim();
    if (typeof energy === "string" && energy.trim()) data.energy = energy.trim();

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: { id: true, email: true, mood: true, energy: true },
    });

    return res.json({ message: "Updated", user });
  } catch (e) {
    console.error("UPDATE_ME_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});



app.get("/mood", authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { mood: true, energy: true },
    });
    return res.json({
      mood: user?.mood || "NEUTRAL",
      energy: user?.energy || "MEDIUM",
    });
  } catch (e) {
    console.error("GET_MOOD_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/mood", authRequired, async (req, res) => {
  try {
    const { mood, energy } = req.body || {};
    const data = {};
    if (typeof mood === "string" && mood.trim()) data.mood = mood.trim();
    if (typeof energy === "string" && energy.trim()) data.energy = energy.trim();

    await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: { id: true },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("SET_MOOD_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});



app.post("/ai/suggest", authRequired, async (req, res) => {
  try {
    const { prompt, tasks } = req.body || {};
    const p = String(prompt || "").toLowerCase();

    const suggestions = [];
    const list = Array.isArray(tasks) ? tasks : [];
    const incomplete = list.filter((t) => t?.status !== "COMPLETED");

    if (incomplete.length === 0) {
      suggestions.push("Start with a quick win: create one small task (15–30 min).");
    } else {
      suggestions.push("Pick 1 task and finish it before starting another.");
      suggestions.push("Split a big task into 3 smaller steps to reduce friction.");
    }

    if (p.includes("study") || p.includes("exam")) {
      suggestions.unshift("Study sprint: 25 minutes focus + 5 minutes break (repeat twice).");
    }
    if (p.includes("deadline") || p.includes("today")) {
      suggestions.unshift("Deadline mode: do the highest-impact task first (no multitasking).");
    }

    return res.json({ suggestions: suggestions.slice(0, 6) });
  } catch (e) {
    console.error("AI_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});


async function forgotHandler(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email required" });

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await prisma.user.findFirst({ where: { email: normalizedEmail } });
    if (!user) return res.status(404).json({ message: "User not found" });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    const transporter = createMailer();
    const resetLink = `${APP_BASE_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: normalizedEmail,
      subject: "Reset password",
      html: `<a href="${resetLink}">Reset password</a>`,
    });

    return res.json({ message: "Reset email sent" });
  } catch (e) {
    console.error("FORGOT_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

app.post("/auth/forgot-password", forgotHandler);
app.post("/forgot-password", forgotHandler);


async function resetHandler(req, res) {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ message: "Missing data" });

    const user = await prisma.user.findFirst({ where: { resetToken: token } });
    if (!user) return res.status(400).json({ message: "Invalid token" });

    if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ message: "Token expired" });
    }

    const hashed = await bcrypt.hash(String(password), 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetToken: null, resetTokenExpiry: null },
    });

    return res.json({ message: "Password updated" });
  } catch (e) {
    console.error("RESET_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

app.post("/auth/reset-password", resetHandler);
app.post("/reset-password", resetHandler);


app.get("/tasks", authRequired, async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ tasks });
  } catch (e) {
    console.error("GET_TASKS_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/tasks", authRequired, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();

    const rawEnergy = req.body?.energy ?? req.body?.energyLevel ?? "MEDIUM";
    const energy = normalizeEnergy(rawEnergy);

    let duration = req.body?.duration;
    if (duration == null) duration = req.body?.durationMinutes;
    if (duration == null && req.body?.durationHours != null) {
      duration = Math.round(Number(req.body.durationHours) * 60);
    }
    duration = Number(duration);

    if (!title) return res.status(400).json({ message: "Title is required" });
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ message: "Duration is required" });
    }

    const task = await prisma.task.create({
      data: {
        title,
        duration: Math.round(duration),
        energy,
        status: "PENDING",
        userId: req.user.userId,
      },
    });

    return res.json({ task });
  } catch (e) {
    console.error("CREATE_TASK_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

app.patch("/tasks/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const status = normalizeStatus(req.body?.status);
    if (!status) return res.status(400).json({ message: "Invalid status" });

    const result = await prisma.task.updateMany({
      where: { id, userId: req.user.userId },
      data: { status },
    });

    if (result.count === 0) return res.status(404).json({ message: "Task not found" });

    const task = await prisma.task.findFirst({
      where: { id, userId: req.user.userId },
    });

    return res.json({ task });
  } catch (e) {
    console.error("PATCH_TASK_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

app.delete("/tasks/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const result = await prisma.task.deleteMany({
      where: { id, userId: req.user.userId },
    });

    if (result.count === 0) return res.status(404).json({ message: "Task not found" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE_TASK_ERROR:", e);
    return res.status(500).json({ message: "Server error" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend running http://localhost:${PORT}`));