const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const schedule = require('node-schedule');
require('dotenv').config();

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Telegram Bot Setup
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Express Setup
const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3001;

// CORS Setup
const corsOptions = {
  origin: ['http://localhost:3000', 'https://baguvix-mini-app.vercel.app'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Admin Telegram IDs
const adminTelegramIds = [
  '5793122261',
  '292027815',
  '7518336354', // Replace with your actual admin IDs
];

// Telegram Authentication
app.get('/auth/telegram', async (req, res) => {
  const { id, username, hash } = req.query;

  try {
    const { data, error } = await supabase
      .from('usersa')
      .select('*')
      .eq('telegram_id', id)
      .single();

    if (error && error.code === 'PGRST116') {
      const { error: insertError } = await supabase
        .from('usersa')
        .insert([{ telegram_id: id, username }]);

      if (insertError) {
        return res.status(500).json({ error: 'Ошибка при создании пользователя' });
      }
      return res.send('Login success');
    } else if (error) {
        return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (error) {
    console.error("Error during Telegram auth:", error);
    return res.status(500).json({ error: "An unexpected error occurred" });
  }
});


// Content Management
app.get('/api/content/materials', async (req, res) => {
  const { format, category, search, sort } = req.query;
  let query = supabase.from('materials').select('*');

  if (format) {
    query = query.eq('format', format);
  }
  if (category) {
    query = query.eq('category', category);
  }
  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  }
  if (sort) {
    query = query.order(sort);
  }

  try {
    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Ошибка при получении материалов' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error retrieving materials:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

app.post('/api/admin/add-material', async (req, res) => {
  const { title, description, content, format, category, videoUrl } = req.body;

  try {
    const { data, error } = await supabase
      .from('materials')
      .insert([{ title, description, content, format, category, video_url: videoUrl }]);

    if (error) {
      return res.status(500).json({ error: 'Ошибка при добавлении материала' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error adding material:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

app.put('/api/admin/edit-material/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, content, format, category, videoUrl } = req.body;

  try {
    const { data, error } = await supabase
      .from('materials')
      .update({ title, description, content, format, category, video_url: videoUrl })
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: 'Ошибка при обновлении материала' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error updating material:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

app.delete('/api/admin/delete-material/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('materials')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: 'Ошибка при удалении материала' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error deleting material:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

// Subscription Management
app.post('/api/subscription/subscribe', async (req, res) => {
  const { userId, level, duration } = req.body;

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .insert([{ user_id: userId, level, start_date: new Date(), end_date: new Date(new Date().setMonth(new Date().getMonth() + duration)) }]);

    if (error) {
      return res.status(500).json({ error: 'Ошибка при создании подписки' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error subscribing user:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

app.get('/api/subscription/status/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('end_date', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Ошибка при получении статуса подписки' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error getting subscription status:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

app.post('/api/subscription/extend', async (req, res) => {
  const { userId, planId } = req.body;

  try {
    const { data: subscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('end_date', { ascending: false })
      .limit(1)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: 'Ошибка при получении подписки' });
    }

    let newEndDate;
    if (subscription.end_date) {
      newEndDate = new Date(subscription.end_date);
    } else {
      newEndDate = new Date();
    }

    const duration = planId === 1 ? 1 : planId === 2 ? 6 : 12;
    newEndDate.setMonth(newEndDate.getMonth() + duration);

    const { data, error } = await supabase
      .from('subscriptions')
      .update({ end_date: newEndDate })
      .eq('id', subscription.id);

    if (error) {
      return res.status(500).json({ error: 'Ошибка при продлении подписки' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error extending subscription:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});


// Robokassa Integration
const merchantLogin = process.env.ROBOKASSA_LOGIN;
const password1 = process.env.ROBOKASSA_PASSWORD1;
const password2 = process.env.ROBOKASSA_PASSWORD2;

function generateSignature(params) {
  const sortedParams = Object.keys(params).sort();
  let str = sortedParams.map(key => `${key}:${params[key]}`).join(':');
  str += `:${password1}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

function generatePaymentLink(userId, level, duration, amount) {
  const invId = `${userId}_${level}_${duration}`;
  const params = {
    MrchLogin: merchantLogin,
    OutSum: amount,
    InvId: invId,
    Desc: `Подписка Уровень ${level} на ${duration} месяцев`,
    SignatureValue: generateSignature({ MrchLogin: merchantLogin, OutSum: amount, InvId: invId, Desc: `Подписка Уровень ${level} на ${duration} месяцев` }),
    IsTest: 0, // Set to 0 for production, 1 for testing
  };

  const queryString = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  return {
    text: `Оплатить ${amount} руб.`,
    url: `https://auth.robokassa.ru/Merchant/Index.aspx?${queryString}`
  };
}

app.post('/api/payment/callback', async (req, res) => {
  const { OutSum, InvId, SignatureValue } = req.body;
  const params = { OutSum, InvId, MrchLogin: merchantLogin };
  const signature = generateSignature(params);

  try {
    if (signature !== SignatureValue) {
      return res.status(400).send('Неверная подпись');
    }

    const [userId, level, duration] = InvId.split('_');
    const { data: subscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('end_date', { ascending: false })
      .limit(1)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: 'Ошибка при получении подписки' });
    }

    const newEndDate = new Date(subscription ? subscription.end_date : new Date());
    newEndDate.setMonth(newEndDate.getMonth() + parseInt(duration));

    const { data, error } = await supabase
      .from('subscriptions')
      .upsert([{ user_id: userId, level, start_date: new Date(), end_date: newEndDate }]);

    if (error) {
      return res.status(500).json({ error: 'Ошибка при обновлении подписки' });
    }

    bot.sendMessage(userId, 'Оплата прошла успешно! Ваша подписка продлена.');

    res.send('OK');
  } catch (error) {
    console.error("Error handling Robokassa callback:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});


// Subscription Notifications
schedule.scheduleJob('0 0 * * *', async () => {
  const today = new Date();
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setDate(today.getDate() + 3);

  const todayISO = today.toISOString();
  const threeDaysFromNowISO = threeDaysFromNow.toISOString();

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .lte('end_date', threeDaysFromNowISO)
      .gte('end_date', todayISO);

    if (error) {
      console.error('Ошибка при получении подписок для уведомлений', error);
      return;
    }

    data.forEach(subscription => {
      const daysLeft = Math.ceil((new Date(subscription.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      bot.sendMessage(subscription.user_id, `Ваша подписка истекает через ${daysLeft} дня(ей). Продлите подписку, чтобы не потерять доступ к контенту.`);
    });
  } catch (error) {
    console.error("Error sending subscription notifications:", error);
  }
});

// Telegram Bot Commands
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const { data: user, error } = await supabase
      .from('usersa')
      .select('*')
      .eq('telegram_id', chatId)
      .single();

    if (error && error.code === 'PGRST116') {
      await supabase
        .from('usersa')
        .insert([{ telegram_id: chatId, username: msg.chat.username, first_name: msg.chat.first_name, last_name: msg.chat.last_name }]);
    }

    // Send welcome video (replace './video.mp4' with the actual path)
    await bot.sendVideo(chatId, './video.mp4', { //Make sure this file exists and is accessible to the server.
      caption: 'Добро пожаловать в сообщество радикального саморазвития...\n\n' + //Your welcome message
               '...', //Rest of your message
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Уровень 1', callback_data: 'level_1' }],
          [{ text: 'Уровень 2', callback_data: 'level_2' }],
          [{ text: 'Сообщество "BAGUVIX"', url: 'https://telegra.ph/Soobshchestvo-BAGUVIX-03-05' }],
          [{ text: 'Открыть мини-приложение', callback_data: 'open_app' }],
          ...(adminTelegramIds.includes(chatId.toString()) ? [[{ text: 'Админ-панель', callback_data: 'admin_panel' }]] : []),
        ],
      },
    }).catch(err => console.error("Error sending welcome video:", err));

  } catch (error) {
    console.error("Error handling /start command:", error);
    bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    const { data: user, error } = await supabase
      .from('usersa')
      .select('id')
      .eq('telegram_id', chatId)
      .single();

    if (error) {
      console.error('Ошибка при получении пользователя', error);
      return bot.sendMessage(chatId, 'Произошла ошибка при получении информации о пользователе.');
    }

    const userId = user.id;

    if (data === 'admin_panel') {
      const adminUrl = 'https://baguvix-mini-app.vercel.app/admin';
      bot.sendMessage(chatId, 'Открыть админ-панель', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть админ-панель', web_app: { url: adminUrl } }],
          ],
        },
      });
    } else if (data === 'open_app') {
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('end_date', { ascending: false })
        .limit(1)
        .single();

      if (error || !subscription || new Date(subscription.end_date) < new Date()) {
        bot.sendMessage(chatId, 'У вас нет активной подписки. Подпишитесь на один из тарифов.');
      } else {
        const miniAppUrl = `https://baguvix-mini-app.vercel.app/login?chatId=${chatId}`;
        bot.sendMessage(chatId, 'Открыть мини-приложение', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Открыть мини-приложение', web_app: { url: miniAppUrl } }],
            ],
          },
        });
      }
    } else if (data === 'level_1' || data === 'level_2') {
      const level = data === 'level_1' ? 1 : 2;
      const message = `Выберите срок подписки для Уровня ${level}:`;
      const options = [1, 3, 6, 12].map(duration => ({
          text: `${duration} месяц${duration === 1 ? '' : 'а'} - ${calculateAmount(level, duration)} руб`,
          callback_data: `duration_${duration}_${level}`
        }));
      const keyboard = [options.map(option => ({ text: option.text, callback_data: option.callback_data }))];

      bot.sendMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    } else if (data.startsWith('duration_')) {
      const [duration, level] = data.split('_').slice(1);
      const paymentButton = generatePaymentLink(userId, level, duration, calculateAmount(level, duration));

      bot.sendMessage(chatId, `Отлично, подписка на Уровень ${level} на ${duration} месяц(ев).`, {
        reply_markup: {
          inline_keyboard: [[paymentButton]]
        }
      });
    }
  } catch (error) {
    console.error("Error handling callback query:", error);
    bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
});


// Calculate Amount Function
function calculateAmount(level, duration) {
  const prices = {
    level_1: {
      '1': 1490,
      '3': 3990,
      '6': 7490,
      '12': 14290,
    },
    level_2: {
      '1': 4990,
      '3': 13390,
      '6': 25390,
      '12': 47890,
    },
  };

  return prices[`level_${level}`][duration];
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
