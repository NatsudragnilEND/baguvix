const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const schedule = require('node-schedule');
require('dotenv').config();

// Настройка Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Настройка Telegram-бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Настройка Express
const app = express();
const PORT = process.env.PORT || 3001;
app.use(bodyParser.json());

// Настройка CORS
const corsOptions = {
  origin: ['http://localhost:3000', 'https://baguvix-mini-app.vercel.app'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Массив Telegram ID администраторов
const adminTelegramIds = [
  '5793122261',
  '292027815',
  '7518336354'
];

// Авторизация через Telegram
app.get('/auth/telegram', async (req, res) => {
  const { id, username, hash } = req.query;

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

    return 'login success';
  }

  return res.json(data);
});

// Управление контентом
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

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Ошибка при получении материалов' });
  }

  res.json(data);
});

app.post('/api/admin/add-material', async (req, res) => {
  const { title, description, content, format, category, videoUrl } = req.body;

  const { data, error } = await supabase
    .from('materials')
    .insert([{ title, description, content, format, category, video_url: videoUrl }]);

  if (error) {
    return res.status(500).json({ error: 'Ошибка при добавлении материала' });
  }

  res.json(data);
});

app.put('/api/admin/edit-material/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, content, format, category, videoUrl } = req.body;

  const { data, error } = await supabase
    .from('materials')
    .update({ title, description, content, format, category, video_url: videoUrl })
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: 'Ошибка при обновлении материала' });
  }

  res.json(data);
});

app.delete('/api/admin/delete-material/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('materials')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: 'Ошибка при удалении материала' });
  }

  res.json(data);
});

// Управление подписками
app.post('/api/subscription/subscribe', async (req, res) => {
  const { userId, level, duration } = req.body;

  const { data, error } = await supabase
    .from('subscriptions')
    .insert([{ user_id: userId, level, start_date: new Date(), end_date: new Date(new Date().setMonth(new Date().getMonth() + duration)) }]);

  if (error) {
    console.log(error);
    return res.status(500).json({ error: 'Ошибка при создании подписки' });
  }

  res.json(data);
});

app.get('/api/subscription/status/:userId', async (req, res) => {
  const { userId } = req.params;

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
});

app.post('/api/subscription/extend', async (req, res) => {
  const { userId, planId } = req.body;

  const { data: subscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('end_date', { ascending: false })
    .limit(1)
    .single();

  if (fetchError) {
    console.log(userId);
    console.log(fetchError);
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
    console.log(error);
    console.log('Error extending subscription');
    return res.status(500).json({ error: 'Ошибка при продлении подписки' });
  }

  res.json(data);
});

// Интеграция с Robokassa
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
    IsTest: 1,
  };

  const queryString = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  return `https://auth.robokassa.ru/Merchant/Index.aspx?${queryString}`;
}

app.post('/api/payment/callback', async (req, res) => {
  const { OutSum, InvId, SignatureValue } = req.body;
  const params = { OutSum, InvId, MrchLogin: merchantLogin };
  const signature = generateSignature(params);

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
});

// Уведомления о подписке
schedule.scheduleJob('0 0 * * *', async () => {
  const today = new Date();
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setDate(today.getDate() + 3);

  const todayISO = today.toISOString();
  const threeDaysFromNowISO = threeDaysFromNow.toISOString();

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
});

// Telegram-бот
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

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

  // Send the video
  await bot.sendVideo(chatId, './video.mp4', {
    caption: 'Добро пожаловать в сообщество радикального саморазвития\n\n' +
             'В мире, где большинство живет на автопилоте, мы создаем среду для тех, кто берет ответственность за свою жизнь. ' +
             'Здесь нет случайных людей — только те, кто выбрал путь развития.\n\n' +
             'Что ты получишь:\n' +
             '✔ Системное саморазвитие — не просто советы, а пошаговую стратегию роста.\n' +
             '✔ Психология силы — дисциплина, управление собой, достижение целей.\n' +
             '✔ Физическая мощь — тренировки, нутрицевтика, восстановление.\n' +
             '✔ Развитие интеллекта — стратегическое мышление, контроль эмоций.\n' +
             '✔ Природа мужчины и женщины — гормоны, отношения, социальные роли.\n' +
             '✔ Максимальная продуктивность — биохакинг, работа с ресурсами организма.\n' +
             '✔ Среда сильных — вокруг тебя будут предприниматели, бойцы, элитные спортсмены, профессионалы.\n\n' +
             'Мы не даем пустых обещаний — только реальные инструменты и окружение, которое заставит тебя расти.\n\n' +
             'Если ты не готов меняться — проходи мимо. Если готов — добро пожаловать.',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Уровень 1', callback_data: 'level_1' }],
        [{ text: 'Уровень 2', callback_data: 'level_2' }],
        [{ text: 'Сообщество "BAGUVIX"', url: 'https://telegra.ph/Soobshchestvo-BAGUVIX-03-05' }],
        [{ text: 'Открыть мини-приложение', callback_data: 'open_app' }],
        ...(adminTelegramIds.includes(chatId.toString()) ? [[{ text: 'Админ-панель', callback_data: 'admin_panel' }]] : []),
      ],
    },
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

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
          [
            {
              text: 'Открыть админ-панель',
              web_app: { url: adminUrl }
            }
          ],
        ],
      },
    });
  } else if (data.startsWith('pay_')) {
    const [level, duration] = data.split('_').slice(1);
    const amount = calculateAmount(level, duration);
    const paymentLink = generatePaymentLink(userId, level, duration, amount);
    bot.sendMessage(chatId, `Оплатите подписку по ссылке:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Оплатить', url: paymentLink }],
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
            [
              {
                text: 'Открыть мини-приложение',
                web_app: { url: miniAppUrl }
              }
            ],
          ],
        },
      });
    }
  } else if (data === 'level_1') {
    bot.sendMessage(chatId, `Выберите срок подписки для Уровня 1:

      Доступ ко всему, что изменит твое восприятие реальности.
 • Закрытые лекции и статьи, где собраны главные принципы выживания, роста и доминирования в этом мире.
 • Конкретные инструменты для понимания себя, окружающих и сил, которые управляют этим миром.
 • Материалы по биохакингу, гормональному балансу, тренировкам, психологии и философии, которые дают преимущество.
 • Закрытая библиотека знаний – то, что не найдешь в открытом доступе.

Ты станешь частью круга, который мыслит иначе, который видит больше, который избежал ловушек слабости и иллюзий. `, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `1 месяц - ${calculateAmount(1, 1)} руб`, callback_data: 'duration_1_1' }],
          [{ text: `3 месяца - ${calculateAmount(1, 3)} руб`, callback_data: 'duration_3_1' }],
          [{ text: `6 месяцев - ${calculateAmount(1, 6)} руб`, callback_data: 'duration_6_1' }],
          [{ text: `1 год - ${calculateAmount(1, 12)} руб`, callback_data: 'duration_12_1' }],
        ],
      },
    });
  } else if (data === 'level_2') {
    bot.sendMessage(chatId, `Выберите срок подписки для Уровня 2:

      Знания — это мощь, но индивидуальное направление – это оружие. Здесь ты получаешь не просто информацию, а прямую связь с теми, кто знает путь.

Включает всё из первого тарифа, плюс:

 • Чат, где мы – кураторы – разбираем конкретно твои вопросы, твои ситуации, твои вызовы.
 • Общение с другими участниками, которые, как и ты, движутся к пониманию, дисциплине и силе.
 • Живые встречи – несколько раз в месяц. Где не просто слова, а работа над собой.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `1 месяц - ${calculateAmount(2, 1)} руб`, callback_data: 'duration_1_2' }],
          [{ text: `3 месяца - ${calculateAmount(2, 3)} руб`, callback_data: 'duration_3_2' }],
          [{ text: `6 месяцев - ${calculateAmount(2, 6)} руб`, callback_data: 'duration_6_2' }],
          [{ text: `1 год - ${calculateAmount(2, 12)} руб`, callback_data: 'duration_12_2' }],
        ],
      },
    });
  } else if (data.startsWith('duration_')) {
    const [duration, level] = data.split('_').slice(1);
    bot.sendMessage(chatId, `Отлично, подписка на Уровень ${level} на ${duration} месяц(ев). Для оформления нажмите 'Оплатить'.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Оплатить`, callback_data: `pay_${level}_${duration}` }],
        ],
      },
    });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

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
