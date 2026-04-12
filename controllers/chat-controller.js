const Groq = require("groq-sdk");
const { Cardio, Resistance } = require("../models");

const groq = new Groq({ apiKey: process.env.API_KEY?.trim() });

const OUT_OF_SCOPE_REPLY =
  "I can only help with health, fitness, nutrition, recovery, sleep, and healthy lifestyle topics. Please ask something in that area.";

const LOGIN_REQUIRED_PROFILE_REPLY =
  "I cannot access your past records or personal routine unless you are logged in. Please log in and ask again so I can use your workout history.";

const ALLOWED_TOPIC_PATTERN =
  /\b(fitness|workout|exercise|training|gym|cardio|resistance|strength|muscle|reps?|sets?|weight|calorie|calories|nutrition|diet|meal|protein|hydration|water|sleep|recovery|stretch|mobility|posture|injury|wellness|healthy|health|lifestyle|habit|steps?|walking|running|jogging|cycling|yoga|pilates|hiit|fat loss|weight loss|bulk|cut)\b/i;

const FOLLOW_UP_PATTERN =
  /\b(it|that|this|those|these|more|another|again|why|how|when|what about|can i|should i)\b/i;

const isInDomain = (content = "") => ALLOWED_TOPIC_PATTERN.test(content);

const PERSONAL_DATA_INTENT_PATTERN =
  /\b(my|mine|me|i|past|history|records?|record|routine|progress|profile|stats|performance|did i do|what did i do|how many|last workout|previous workout|weekly summary|monthly summary)\b/i;

const isPersonalHistoryIntent = (content = "") =>
  PERSONAL_DATA_INTENT_PATTERN.test(content);

const shouldAcceptUserMessage = (messages = []) => {
  const userMessages = messages.filter((message) => message.role === "user");
  const latest = userMessages[userMessages.length - 1];

  if (!latest) {
    return false;
  }

  if (isInDomain(latest.content)) {
    return true;
  }

  // Treat personal workout-history requests as in-domain fitness context.
  if (isPersonalHistoryIntent(latest.content)) {
    return true;
  }

  // Allow short follow-ups when the prior user context is in-domain.
  const priorUserMessages = userMessages.slice(0, -1);
  const hasInDomainContext = priorUserMessages.some((message) => isInDomain(message.content));
  const hasPersonalHistoryContext = priorUserMessages.some((message) =>
    isPersonalHistoryIntent(message.content)
  );

  return (hasInDomainContext || hasPersonalHistoryContext) && FOLLOW_UP_PATTERN.test(latest.content);
};

const asksForPersonalHistory = (messages = []) => {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return false;
  }

  return isPersonalHistoryIntent(latestUserMessage.content || "");
};

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

      if (!shouldAcceptUserMessage(trimmedMessages)) {
        return res.json({ message: OUT_OF_SCOPE_REPLY });
      }

      const timeScope = getTimeScope(trimmedMessages);
      const rangeMap = {
        today: getTodayRange(),
        yesterday: getYesterdayRange(),
        week: getThisWeekRange(),
        month: getThisMonthRange(),
      };
      const isAuthed = Boolean(req.user?._id);

      if (!isAuthed && asksForPersonalHistory(trimmedMessages)) {
        return res.json({ message: LOGIN_REQUIRED_PROFILE_REPLY });
      }

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

      const systemPrompt = `You are a fitness assistant in a workout tracking app.

    You can ONLY answer topics related to health, fitness, exercise, nutrition, recovery, sleep, and healthy lifestyle habits.
    If a user asks about anything outside those topics, reply exactly with:
    "${OUT_OF_SCOPE_REPLY}"

    ${timeScopeText} workouts ${scopeText}:
    ${workouts}

    Keep responses short, practical, and supportive.`;

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
