// =========================================================================
// РАЗДЕЛ 1: ОТРИСОВКА КАРТОЧЕК И ПОКУПКА УЛУЧШЕНИЙ (ШАХТА)
// =========================================================================

// Функция отрисовки карточек улучшений
function renderCards(userPurchasedCards) {
  const container = document.getElementById('cards-container');
  container.innerHTML = ''; // Очищаем контейнер перед перерисовкой

  upgradeCards.forEach(card => {
    // Ищем, какой уровень у игрока для текущей карточки
    const userCard = userPurchasedCards.find(c => c.cardId === card.id);
    const currentLevel = userCard ? userCard.level : 0;

    // Рассчитываем динамическую цену и профит по экспоненциальной формуле
    const currentPrice = Math.floor(card.basePrice * Math.pow(1.5, currentLevel));
    const nextProfit = Math.floor(card.baseProfit * Math.pow(1.2, currentLevel));

    // Создаем DOM-элемент карточки
    const cardElement = document.createElement('div');
    cardElement.className = `card-item ${gameState.balance < currentPrice ? 'disabled' : ''}`;
    cardElement.innerHTML = `
      <div class="card-icon">${card.icon}</div>
      <div class="card-title">${card.name}</div>
      <div class="card-level">Ур. ${currentLevel}</div>
      <div class="card-profit">📊 +${nextProfit}/час</div>
      <button class="buy-btn" onclick="buyCard('${card.id}', ${currentPrice})" ${gameState.balance < currentPrice ? 'disabled' : ''}>
        💰 ${currentPrice}
      </button>
    `;
    container.appendChild(cardElement);
  });
}

// Функция отправки запроса на покупку карточки на бэкенд
async function buyCard(cardId, price) {
  if (gameState.balance < price) return alert("Не хватает монет!");

  // Оптимистичный апдейт баланса на клиенте для мгновенного отклика
  gameState.balance -= price;
  document.getElementById('balance-display').innerText = gameState.balance;

  const response = await fetch('/api/user/buy-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId: currentUser.telegramId, cardId })
  });

  const data = await response.json();
  if (data.success) {
    // Обновляем глобальное состояние актуальными данными от сервера
    gameState.balance = data.user.balance;
    renderCards(data.user.purchasedCards);
    document.getElementById('profit-display').innerText = data.user.profitPerHour;
  } else {
    alert("Ошибка при покупке: " + data.error);
  }
}

// =========================================================================
// РАЗДЕЛ 2: СИСТЕМА УРОВНЕЙ И ЛИГ ХОМЯКА
// =========================================================================

function updatePlayerRank(totalEarned) {
  let currentRank = LEVLES_CONFIG[0];
  let nextRank = LEVLES_CONFIG[1];

  // Ищем текущую и следующую лигу на основе общей суммы заработка totalEarned
  for (let i = 0; i < LEVLES_CONFIG.length; i++) {
    if (totalEarned >= LEVLES_CONFIG[i].minCoins) {
      currentRank = LEVLES_CONFIG[i];
      nextRank = LEVLES_CONFIG[i + 1] || null;
    } else {
      break;
    }
  }

  // Обновляем текстовые элементы интерфейса и картинку ранга
  document.getElementById('rank-name').innerText = currentRank.name;
  document.getElementById('rank-level').innerText = `Уровень ${currentRank.level}/5`;
  
  const charImg = document.getElementById('character-img');
  if (charImg.getAttribute('src') !== currentRank.image) {
    charImg.src = currentRank.image;
    if (typeof triggerLevelUpAnimation === 'function') triggerLevelUpAnimation();
  }

  // Рассчитываем процент заполнения шкалы прогресса лиги
  const progressFill = document.getElementById('rank-progress-fill');
  if (nextRank) {
    const coinsInCurrentLevel = totalEarned - currentRank.minCoins;
    const coinsRequiredForNextLevel = nextRank.minCoins - currentRank.minCoins;
    const percentage = (coinsInCurrentLevel / coinsRequiredForNextLevel) * 100;
    
    progressFill.style.width = `${Math.min(percentage, 100)}%`;
  } else {
    progressFill.style.width = "100%";
    document.getElementById('rank-level').innerText = `Макс. уровень 🎉`;
  }
}
// =========================================================================
// РАЗДЕЛ 3: ЕЖЕДНЕВНЫЙ КАЛЕНДАРЬ НАГРАД (СТРИКИ)
// =========================================================================

// Функция отрисовки сетки наград на 10 дней
function renderDailyRewardsCalendar(userStreak, isClaimedToday) {
  const grid = document.getElementById('rewards-grid');
  grid.innerHTML = '';

  const claimBtn = document.getElementById('claim-daily-btn');
  
  // Переключение состояния главной кнопки забора награды
  if (isClaimedToday) {
    claimBtn.innerText = "Приходи завтра! ⏱️";
    claimBtn.disabled = true;
  } else {
    claimBtn.innerText = "Забрать награду! 💰";
    claimBtn.disabled = false;
  }

  // Генерируем 10 блоков дней внутри календаря
  for (let day = 1; day <= 10; day++) {
    const dayBox = document.createElement('div');
    dayBox.className = 'day-box';
    
    // Присвоение стилей CSS в зависимости от статуса дня
    if (day < userStreak || (day === userStreak && isClaimedToday)) {
      dayBox.classList.add('completed'); 
    } else if (day === userStreak && !isClaimedToday) {
      dayBox.classList.add('current');   
    } else {
      dayBox.classList.add('locked');    
    }

    dayBox.innerHTML = `
      <div class="day-num">День ${day}</div>
      <div class="day-icon">🪙</div>
      <div class="day-coins">+${formatCoins(DAILY_REWARDS_CONFIG[day])}</div>
    `;
    grid.appendChild(dayBox);
  }
}

// Утилита сокращения больших чисел (например, 5000000 -> 5M)
function formatCoins(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(0) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
  return num;
}

// Слушатель клика по кнопке получения ежедневного бонуса
document.getElementById('claim-daily-btn').addEventListener('click', async () => {
  const response = await fetch('/api/user/claim-daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId: currentUser.telegramId })
  });

  const data = await response.json();
  if (data.success) {
    alert(`Поздравляем! Вы получили награду дня!`);
    gameState.balance = data.balance;
    document.getElementById('balance-display').innerText = gameState.balance;
    renderDailyRewardsCalendar(data.dailyStreak, true);
  } else {
    alert(data.error);
  }
});
/* =========================================================================
   РАЗДЕЛ 4: СТИЛИ СЕТКИ КАРТОЧЕК И ИНТЕРФЕЙСА МАГАЗИНА УЛУЧШЕНИЙ
   ========================================================================= */

/* Двухколоночный грид-контейнер для карточек шахты */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 16px;
}

/* Стилизация отдельного блока карточки */
.card-item {
  background: #2c2d30;
  border-radius: 12px;
  padding: 12px;
  text-align: center;
  color: white;
  border: 1px solid #3d3e42;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

/* Состояние заблокированной карточки (недостаточно монет для покупки) */
.card-item.disabled {
  opacity: 0.6;
}

/* Стили кнопки улучшения внутри карточки */
.buy-btn {
  background: #f3ba2f;
  color: black;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  margin-top: 8px;
  width: 100%;
  transition: background-color 0.2s ease;
}

/* Эффект при наведении на доступную кнопку */
.buy-btn:not(:disabled):hover {
  background-color: #ff9900;
}

/* Отключение интерактивности кнопки при нехватке монет */
.buy-btn:disabled {
  background: #555;
  color: #888;
  cursor: not-allowed;
}
