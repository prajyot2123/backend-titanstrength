const Groq = require("groq-sdk");
const { Cardio, Resistance } = require("../models");

const groq = new Groq({ apiKey: process.env.API_KEY?.trim() });

const formatWorkoutLine = (workout) => {
  if (workout.type === "cardio") {
    const distance = Number.isFinite(workout.distance)
      ? `${workout.distance} km`
      : "distance";
    return `${workout.name} - ${distance}`;
  }

  const reps = Number.isFinite(workout.reps) ? `${workout.reps} reps` : "reps";
  const weight = Number.isFinite(workout.weight) ? `${workout.weight} kg` : null;
  return `${workout.name} - ${weight ? `${weight}, ` : ""}${reps}`;
};

const getRecentWorkoutLines = async ({ userId, dateRange } = {}) => {
  const match = {
    ...(userId ? { userId } : {}),
    ...(dateRange ? { date: dateRange } : {}),
  };
  const [cardio, resistance] = await Promise.all([
    Cardio.find(match).sort({ date: -1 }).limit(5).lean(),
    Resistance.find(match).sort({ date: -1 }).limit(5).lean(),
  ]);

  const combined = [...cardio, ...resistance]
    .filter((workout) => workout && workout.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (combined.length === 0) {
    return "No recent workouts found.";
  }

  return combined.map(formatWorkoutLine).join("\n");
};

const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { $gte: start, $lt: end };
};

const getYesterdayRange = () => {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - 1);
  return { $gte: start, $lt: end };
};

const getThisWeekRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  return { $gte: start, $lte: now };
};

const getThisMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return { $gte: start, $lte: now };
};

const getTimeScope = (messages) => {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    return "recent";
  }

  const content = lastUserMessage.content || "";

  if (/\btoday\b|\bthis day\b/i.test(content)) {
    return "today";
  }
  if (/\byesterday\b/i.test(content)) {
    return "yesterday";
  }
  if (/\bthis week\b|\bweek so far\b/i.test(content)) {
    return "week";
  }
  if (/\bthis month\b|\bmonth so far\b/i.test(content)) {
    return "month";
  }

  return "recent";
};

module.exports = {
  async chat(req, res) {
    try {
      if (!process.env.API_KEY) {
        return res.status(500).json({ message: "API_KEY is missing." });
      }
      if (!Array.isArray(req.body.messages)) {
        return res.status(400).json({ message: "Messages must be an array." });
      }
      const messages = req.body.messages
        .filter((message) => message && typeof message === "object")
        .map((message) => ({
          role: message.role,
          content: typeof message.content === "string" ? message.content.trim() : "",
        }))
        .filter(
          (message) =>
            (message.role === "user" || message.role === "assistant") &&
            message.content.length > 0
        );

      const trimmedMessages = messages.slice(-10);
      if (trimmedMessages.length === 0) {
        return res.status(400).json({ message: "No valid messages provided." });
      }
      const timeScope = getTimeScope(trimmedMessages);
      const rangeMap = {
        today: getTodayRange(),
        yesterday: getYesterdayRange(),
        week: getThisWeekRange(),
        month: getThisMonthRange(),
      };
      const isAuthed = Boolean(req.user?._id);
      const workouts = isAuthed
        ? await getRecentWorkoutLines({
            userId: req.user?._id,
            dateRange: rangeMap[timeScope] || null,
          })
        : "No user workout data available (not logged in).";
      const scopeText = isAuthed ? "for this user" : "for a guest user";
      const timeScopeText =
        timeScope === "yesterday"
          ? "yesterday"
          : timeScope === "week"
          ? "this week"
          : timeScope === "month"
          ? "this month"
          : timeScope === "today"
          ? "today"
          : "recent";

      const systemPrompt = `You are a fitness assistant in a workout tracking app.\n\n${timeScopeText} workouts ${scopeText}:\n${workouts}\n\nGive short, helpful, practical fitness advice.`;

      const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "system", content: systemPrompt }, ...trimmedMessages],
        temperature: 0.7,
      });

      const message = response.choices?.[0]?.message?.content?.trim();

      res.json({ message: message || "Sorry, I could not generate a response." });
    } catch (error) {
      console.error("Chat request failed:", error);
      res
        .status(500)
        .json({ message: error?.message || "Chat request failed." });
    }
  },
};
