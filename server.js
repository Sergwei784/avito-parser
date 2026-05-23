const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const SECRET_KEY = 'avito_parser_2024';

// Явно указываем путь к Chrome который установили через postinstall
const CHROME_PATH = '/opt/render/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome';

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Avito breadcrumb parser is running' });
});

app.post('/get-search-url', async (req, res) => {

  if (req.headers['x-api-key'] !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { ad_url, keyword } = req.body;

  if (!ad_url || !keyword) {
    return res.status(400).json({ error: 'ad_url и keyword обязательны' });
  }

  let browser;
  try {
    console.log(`[→] Открываю: ${ad_url}`);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--lang=ru-RU',
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });

    await page.goto(ad_url, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector('nav, [data-marker*="breadcrumb"], [class*="breadcrumb"]', {
      timeout: 10000
    }).catch(() => console.log('[!] Селектор не найден, продолжаем...'));

    await new Promise(r => setTimeout(r, 2000));

    const breadcrumbUrl = await page.evaluate(() => {
      const selectors = [
        '[data-marker="breadcrumbs"] a',
        '[data-marker="breadcrumb"] a',
        'nav[aria-label] a',
        '[class*="breadcrumb" i] a',
        '[class*="Breadcrumb"] a',
      ];

      let links = [];
      for (const selector of selectors) {
        const found = Array.from(document.querySelectorAll(selector));
        if (found.length >= 2) {
          links = found;
          break;
        }
      }

      const valid = links
        .map(a => ({ href: a.href, text: a.textContent.trim() }))
        .filter(l =>
          l.href &&
          l.href.includes('avito.ru') &&
          !l.href.includes('/legal') &&
          !l.href.includes('/help') &&
          !l.href.includes('/info') &&
          l.text !== '' &&
          l.text !== 'Главная'
        );

      if (!valid.length) return null;
      return valid[valid.length - 1].href.split('?')[0];
    });

    if (!breadcrumbUrl) {
      const allLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => h.includes('avito.ru'))
          .slice(0, 30)
      );
      console.log('[!] Все ссылки:', allLinks);
      return res.status(404).json({
        error: 'Хлебные крошки не найдены',
        debug_links: allLinks
      });
    }

    const searchUrl = `${breadcrumbUrl}?q=${encodeURIComponent(keyword)}`;
    console.log(`[✓] Результат: ${searchUrl}`);

    res.json({ success: true, search_url: searchUrl, category_url: breadcrumbUrl });

  } catch (err) {
    console.error('[✗] Ошибка:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[✓] Сервер запущен на порту ${PORT}`));
