// =========================================================================
// БЛОК 1: ИНИЦИАЛИЗАЦИЯ TELEGRAM WEBAPP И ФУНКЦИЯ СИНХРОНИЗАЦИИ
// =========================================================================

// Функция для получения Telegram ID текущего пользователя
function getTelegramUserData() {
  // Проверяем, запущено ли приложение внутри Telegram Mini Apps
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
    const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
    return {
      telegramId: tgUser.id.toString(),
      username: tgUser.username || tgUser.first_name || "Игрок"
    };
  }
  
  // Заглушка (Локальный режим) для тестирования в обычном браузере на компьютере
  return {
    telegramId: "123456789", // Тестовый ID
    username: "Test_Hamster" // Тестовое имя
  };
}

// Запоминаем данные пользователя в глобальную переменную фронтенда
const activeUser = getTelegramUserData();

// Главная функция синхронизации при входе
async function initAndSyncGame() {
  try {
    console.log("🔄 Отправка запроса синхронизации для пользователя:", activeUser.telegramId);
    
    // Делаем POST запрос к нашему Node.js бэкенду
    const response = await fetch('https://aaaclickerbackend.onrender.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telegramId: activeUser.telegramId
      })
    });

    const data = await response.json();

    if (data.success && data.user) {
      // Переходим к обработке и отрисовке полученных данных
      applyServerData(data.user);
    } else {
      console.error("❌ Сервер отклонил синхронизацию:", data.error);
      alert("Ошибка загрузки данных профиля.");
    }
  } catch (error) {
    console.error("🌐 Ошибка сети при стартовой синхронизации:", error);
    alert("Не удалось подключиться к серверу игры. Проверьте интернет.");
  }
}
// =========================================================================
// БЛОК 2: ОБНОВЛЕНИЕ ИНТЕРФЕЙСА И РАСЧЕТ ОФЛАЙН-НАГРАДЫ
// =========================================================================

function applyServerData(serverUser) {
  // Вычисляем, сколько монет принес пассивный доход, пока игра была закрыта
  // Для этого вычитаем из нового баланса старый локальный баланс
  const oldBalance = gameState.balance;
  
  // Накатываем эталонные данные из MongoDB на состояние фронтенда
  gameState.balance = serverUser.balance;
  gameState.energy = serverUser.energy;
  gameState.maxEnergy = serverUser.maxEnergy;
  gameState.multitapLevel = serverUser.multitapLevel;

  // 1. Обновляем базовые текстовые блоки на экране
  document.getElementById('balance-display').innerText = gameState.balance;
  document.getElementById('profit-display').innerText = serverUser.profitPerHour;
  document.getElementById('tap-profit-display').innerText = `+${gameState.multitapLevel}`;

  // 2. Вызываем отрисовку шкал, рефералов, лиг и календаря (функции из прошлых частей)
  updateEnergyUI();
  
  if (typeof updatePlayerRank === 'function') {
    updatePlayerRank(serverUser.totalEarned);
  }
  if (typeof renderCards === 'function') {
    renderCards(serverUser.purchasedCards);
  }
  if (typeof renderReferrals === 'function') {
    renderReferrals(serverUser.referrals);
  }
  if (typeof renderDailyRewardsCalendar === 'function') {
    // Проверяем, забирал ли игрок награду сегодня календарно
    const isClaimedToday = serverUser.lastDailyClaim ? 
      new Date(serverUser.lastDailyClaim).toDateString() === new Date().toDateString() : false;
    renderDailyRewardsCalendar(serverUser.dailyStreak, isClaimedToday);
  }

  // 3. Красивое всплывающее окно об офлайн-доходе (Welcome Back Popup)
  const earnedOffline = gameState.balance - oldBalance;
  if (earnedOffline > 0 && oldBalance > 0) {
    setTimeout(() => {
      alert(`🎉 С возвращением!\nПока вы спали, ваш бизнес принес вам: +${earnedOffline} монет! 🪙`);
    }, 1000);
  }
  
  // Сообщаем Telegram WebApp, что приложение полностью загрузилось и готово к показу
  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand(); // Разворачиваем игру на весь экран телефона
  }
}

// АВТОЗАПУСК: Вызываем функцию синхронизации сразу при загрузке скрипта браузером
document.addEventListener("DOMContentLoaded", () => {
  initAndSyncGame();
});
// =========================================================================
// БЛОК 1: ИНИЦИАЛИЗАЦИЯ БУФЕРА КЛИКОВ И НАСТРОЙКА ТАЙМЕРА
// =========================================================================

// Локальное хранилище для кликов, которые еще не ушли на сервер
let clickQueue = {
  pendingClicks: 0,     // Сколько раз пользователь тапнул за текущий интервал
  isSending: false,     // Флаг, защищающий от одновременной отправки двух запросов
  syncInterval: 10000   // Интервал отправки пакета на бэкенд (10 секунд)
};

// Функция, которая вызывается внутри handleTap() при каждом клике по хомяку
function addClickToQueue() {
  // Увеличиваем счетчик накопленных кликов в очереди
  clickQueue.pendingClicks += 1;
  
  // Сбрасываем визуальное предупреждение об ошибке, если оно было
  clearTimeout(window.cheatAlertTimeout);
}

// Фоновый таймер (работает непрерывно на фронтенде)
// Каждые 10 секунд проверяет, были ли клики, и отправляет их на бэкенд
setInterval(async () => {
  // Если кликов не было или прошлый пакет еще отправляется — ничего не делаем
  if (clickQueue.pendingClicks === 0 || clickQueue.isSending) return;

  // Запускаем процесс отправки накопившегося пакета
  await sendClicksToServer();
}, clickQueue.syncInterval);
// =========================================================================
// БЛОК 2: ОТПРАВКА ПАКЕТА НА СЕРВЕР И СИНХРОНИЗАЦИЯ СОСТОЯНИЯ
// =========================================================================

async function sendClicksToServer() {
  // Фиксируем количество отправляемых кликов и временно очищаем очередь
  const clicksToSend = clickQueue.pendingClicks;
  clickQueue.pendingClicks = 0;
  clickQueue.isSending = true;

  try {
    // Отправляем POST-запрос на ваш Node.js сервер
    const response = await fetch('/api/user/click', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telegramId: currentUser.telegramId, // ID текущего игрока Телеграм
        clicksCount: clicksToSend           // Пакет кликов для проверки античитом
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log(`✅ Пакет из ${clicksToSend} кликов успешно синхронизирован с базой данных.`);
      
      // Синхронизируем локальный баланс, уровень и энергию с эталонными данными от сервера
      gameState.balance = data.balance;
      gameState.energy = data.energy;
      
      // Обновляем визуальный интерфейс (баланс, шкалу лиги и энергию)
      document.getElementById('balance-display').innerText = gameState.balance;
      updateEnergyUI();
      if (typeof updatePlayerRank === 'function') {
        updatePlayerRank(data.totalEarned);
      }
    } else {
      // Если сервер вернул ошибку (например, античит зафиксировал слишком быстрые клики)
      console.error('❌ Сервер отклонил пакет кликов:', data.error);
      
      // Возвращаем клики обратно в очередь, чтобы игрок не потерял прогресс из-за сбоя сети
      clickQueue.pendingClicks += clicksToSend;
      
      window.cheatAlertTimeout = setTimeout(() => {
        alert(`Ошибка синхронизации: ${data.error || 'Проверьте соединение'}`);
      }, 500);
    }
  } catch (error) {
    console.error('🌐 Ошибка сети при отправке пакета кликов:', error);
    // В случае падения интернета возвращаем клики в очередь до следующей попытки через 10 сек
    clickQueue.pendingClicks += clicksToSend;
  } finally {
    // Снимаем блокировку отправки в любом случае (успех или провал)
    clickQueue.isSending = false;
  }
}
// =========================================================================
// БЛОК 3: ОТРИСОВКА КАРТОЧЕК И ПОКУПКА УЛУЧШЕНИЙ (МАГАЗИН / ШАХТА)
// =========================================================================

// Функция отрисовки карточек
function renderCards(userPurchasedCards) {
  const container = document.getElementById('cards-container');
  container.innerHTML = ''; // Очищаем перед перерисовкой

  upgradeCards.forEach(card => {
    // Ищем, какой уровень у игрока для этой карточки
    const userCard = userPurchasedCards.find(c => c.cardId === card.id);
    const currentLevel = userCard ? userCard.level : 0; //

    // Рассчитываем динамическую цену и профит по формуле (в стиле Хомяка цена растет экспоненциально)
    const currentPrice = Math.floor(card.basePrice * Math.pow(1.5, currentLevel));
    const nextProfit = Math.floor(card.baseProfit * Math.pow(1.2, currentLevel)); //

    // Создаем элемент карточки
    const cardElement = document.createElement('div');
    cardElement.className = `card-item ${gameState.balance < currentPrice ? 'disabled' : ''}`; //
    cardElement.innerHTML = `
      <div class="card-icon">${card.icon}</div>
      <div class="card-title">${card.name}</div>
      <div class="card-level">Ур. ${currentLevel}</div>
      <div class="card-profit">📊 +${nextProfit}/час</div>
      <button class="buy-btn" onclick="buyCard('${card.id}', ${currentPrice})" ${gameState.balance < currentPrice ? 'disabled' : ''}>
        💰 ${currentPrice}
      </button>
    `; //
    container.appendChild(cardElement); //
  });
}

// Функция отправки запроса на покупку карточки
async function buyCard(cardId, price) {
  if (gameState.balance < price) return alert("Не хватает монет!"); //

  // Оптимистичный апдейт на фронтенде для мгновенного отклика интерфейса
  gameState.balance -= price;
  document.getElementById('balance-display').innerText = gameState.balance; //

  // Отправляем запрос на Node.js сервер
  const response = await fetch('/api/user/buy-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId: activeUser.telegramID, cardId }) //
  });

  const data = await response.json(); //
  if (data.success) {
    // Обновляем состояние игры актуальными данными от сервера
    gameState.balance = data.user.balance;
    renderCards(data.user.purchasedCards); //
    document.getElementById('profit-display').innerText = data.user.profitPerHour; //
  } else {
    alert("Ошибка при покупке: " + data.error); //
  }
}
// =========================================================================
// БЛОК 4: РЕФЕРАЛЬНАЯ СИСТЕМА, РАНГИ И ЕЖЕДНЕВНЫЙ КАЛЕНДАРЬ
// =========================================================================

// Данные текущей сессии (получаем от бэкенда при синхронизации)
const currentUser = {
  telegramId: "123456789", 
  botUsername: "my_hamster_clicker_bot" 
};

// ИСПРАВЛЕНО: Добавлены корректные слеши и интерполяция для реф-ссылки
const refLink = `https://t.me{currentUser.botUsername}?start=ref${currentUser.telegramId}`; //

// Кнопка "Пригласить друга" (Открытие шаринга в Telegram)
document.getElementById('invite-btn').addEventListener('click', () => {
  const shareText = `🚀 Начни кликать в моей игре и получай монеты! Нажми на ссылку, чтобы забрать бонус 5,000 монет!`;
  
  // ИСПРАВЛЕНО: Добавлен корректный эндпоинт отправки ссылки t.me/share/url
  const tgShareUrl = `https://t.me{encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`; //
  
  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.openTelegramLink(tgShareUrl); //
  } else {
    window.open(tgShareUrl, '_blank'); //
  }
});

// Кнопка "Скопировать ссылку" в буфер
document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(refLink).then(() => {
    alert("Ссылка скопирована в буфер обмена!"); //
  });
});

// Отрисовка списка приглашенных друзей
function renderReferrals(referralsArray) {
  document.getElementById('ref-count').innerText = referralsArray.length; //
  const list = document.getElementById('referrals-list');
  list.innerHTML = ''; //

  referralsArray.forEach(ref => {
    const li = document.createElement('li');
    li.innerText = `👤 ${ref.username || 'Друг'} (Получено +5,000)`; //
    list.appendChild(li); //
  });
}

// Расчет лиги и обновление полосы опыта
function updatePlayerRank(totalEarned) {
  let currentRank = LEVLES_CONFIG[0];
  let nextRank = LEVLES_CONFIG[1]; //

  for (let i = 0; i < LEVLES_CONFIG.length; i++) {
    if (totalEarned >= LEVLES_CONFIG[i].minCoins) {
      currentRank = LEVLES_CONFIG[i];
      nextRank = LEVLES_CONFIG[i + 1] || null; //
    } else {
      break;
    }
  }

  document.getElementById('rank-name').innerText = currentRank.name;
  document.getElementById('rank-level').innerText = `Уровень ${currentRank.level}/5`; //
  
  const charImg = document.getElementById('character-img');
  if (charImg.getAttribute('src') !== currentRank.image) {
    charImg.src = currentRank.image; //
    if (typeof triggerLevelUpAnimation === "function") triggerLevelUpAnimation(); 
  }

  const progressFill = document.getElementById('rank-progress-fill'); //
  if (nextRank) {
    const coinsInCurrentLevel = totalEarned - currentRank.minCoins;
    const coinsRequiredForNextLevel = nextRank.minCoins - currentRank.minCoins; //
    const percentage = (coinsInCurrentLevel / coinsRequiredForNextLevel) * 100;
    progressFill.style.width = `${Math.min(percentage, 100)}%`; //
  } else {
    progressFill.style.width = "100%"; //
    document.getElementById('rank-level').innerText = `Макс. уровень 🎉`; //
  }
}

// Отрисовка календаря на 10 дней наград
function renderDailyRewardsCalendar(userStreak, isClaimedToday) {
  const grid = document.getElementById('rewards-grid');
  grid.innerHTML = ''; //
  const claimBtn = document.getElementById('claim-daily-btn'); //
  
  if (isClaimedToday) {
    claimBtn.innerText = "Приходи завтра! ⏱️";
    claimBtn.disabled = true; //
  } else {
    claimBtn.innerText = "Забрать награду! 💰";
    claimBtn.disabled = false; //
  }

  for (let day = 1; day <= 10; day++) {
    const dayBox = document.createElement('div');
    dayBox.className = 'day-box'; //
    
    if (day < userStreak || (day === userStreak && isClaimedToday)) {
      dayBox.classList.add('completed'); //
    } else if (day === userStreak && !isClaimedToday) {
      dayBox.classList.add('current'); //
    } else {
      dayBox.classList.add('locked'); //
    }

    dayBox.innerHTML = `
      <div class="day-num">День ${day}</div>
      <div class="day-icon">🪙</div>
      <div class="day-coins">+${formatCoins(DAILY_REWARDS_CONFIG[day])}</div>
    `; //
    grid.appendChild(dayBox); //
  }
}

function formatCoins(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(0) + 'M'; //
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K'; //
  return num; //
}

// Кнопка забора ежедневной награды
document.getElementById('claim-daily-btn').addEventListener('click', async () => {
  const response = await fetch('/api/user/claim-daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId: activeUser.telegramID' }) //
  });

  const data = await response.json(); //
  if (data.success) {
    alert(`Поздравляем! Вы получили награду дня!`); //
    gameState.balance = data.balance;
    document.getElementById('balance-display').innerText = gameState.balance; //
    renderDailyRewardsCalendar(data.dailyStreak, true); //
  } else {
    alert(data.error); //
  }
});
