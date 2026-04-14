/* ============================================================
   GoldNest – Main JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Navbar scroll effect ---------- */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 30);
    });
  }

  /* ---------- Mobile hamburger ---------- */
  const hamburger = document.querySelector('.hamburger');
  const mobileNav = document.querySelector('.mobile-nav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
      const spans = hamburger.querySelectorAll('span');
      hamburger.classList.toggle('active');
      if (hamburger.classList.contains('active')) {
        spans[0].style.transform = 'translateY(7px) rotate(45deg)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'translateY(-7px) rotate(-45deg)';
      } else {
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      }
    });
    // Close mobile nav on link click
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('active');
        hamburger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
      });
    });
  }

  /* ---------- Active nav link ---------- */
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.navbar-links a, .mobile-nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ---------- Scroll-to-top button ---------- */
  const scrollTopBtn = document.querySelector('.scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
    });
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Intersection Observer – fade animations ---------- */
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.fade-up, .fade-in').forEach(el => observer.observe(el));

  /* ---------- Counter animation ---------- */
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

  function animateCounter(el) {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    const decimals = el.dataset.decimals || 0;
    const duration = 2000;
    const start = performance.now();

    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = (target * eased).toFixed(decimals);
      el.textContent = prefix + current + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  /* ---------- FAQ Accordion ---------- */
  document.querySelectorAll('.faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      // Close all
      document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
      // Open clicked if it was closed
      if (!isOpen) item.classList.add('open');
    });
  });

  /* ---------- Gold price ticker simulation ---------- */
  const prices = {
    '24K Gold': { price: 9245, change: +0.42 },
    '22K Gold': { price: 8475, change: +0.38 },
    '18K Gold': { price: 6934, change: +0.31 },
    'Silver': { price: 107, change: -0.15 },
  };

  function updateTicker() {
    document.querySelectorAll('.ticker-item').forEach(item => {
      const name = item.querySelector('.t-name')?.textContent;
      if (prices[name]) {
        const data = prices[name];
        // Small random fluctuation
        data.price += (Math.random() - 0.5) * 2;
        data.change += (Math.random() - 0.5) * 0.05;
        const priceEl = item.querySelector('.t-price');
        const changeEl = item.querySelector('.t-up, .t-down');
        if (priceEl) priceEl.textContent = '₹' + data.price.toFixed(0) + '/g';
        if (changeEl) {
          const isUp = data.change >= 0;
          changeEl.className = isUp ? 't-up' : 't-down';
          changeEl.textContent = (isUp ? '▲' : '▼') + ' ' + Math.abs(data.change).toFixed(2) + '%';
        }
      }
    });
  }
  setInterval(updateTicker, 4000);

  /* ---------- Contact form ---------- */
  const contactForm = document.querySelector('#contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = contactForm.querySelector('button[type="submit"]');
      btn.textContent = 'Sending…';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = 'Message Sent ✓';
        btn.style.background = 'linear-gradient(135deg, #22C55E, #16A34A)';
        contactForm.reset();
        setTimeout(() => {
          btn.textContent = 'Send Message';
          btn.style.background = '';
          btn.disabled = false;
        }, 4000);
      }, 1800);
    });
  }

  /* ---------- SIP Calculator ---------- */
  const sipForm = document.querySelector('#sipCalc');
  if (sipForm) {
    function calcSIP() {
      const amount = parseFloat(document.querySelector('#sipAmount')?.value) || 500;
      const years = parseFloat(document.querySelector('#sipYears')?.value) || 5;
      const rate = 0.12; // assumed 12% annual return
      const months = years * 12;
      const r = rate / 12;
      const fv = amount * ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
      const invested = amount * months;
      const gains = fv - invested;

      const resInvested = document.querySelector('#res-invested');
      const resGains = document.querySelector('#res-gains');
      const resTotal = document.querySelector('#res-total');

      if (resInvested) resInvested.textContent = '₹' + Math.round(invested).toLocaleString('en-IN');
      if (resGains) resGains.textContent = '₹' + Math.round(gains).toLocaleString('en-IN');
      if (resTotal) resTotal.textContent = '₹' + Math.round(fv).toLocaleString('en-IN');
    }
    sipForm.querySelectorAll('input[type="range"], input[type="number"]').forEach(inp => {
      inp.addEventListener('input', calcSIP);
    });
    calcSIP();
  }

  /* ---------- Hero particles ---------- */
  const particleContainer = document.querySelector('.hero-particles');
  if (particleContainer) {
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.width = p.style.height = (Math.random() * 3 + 1) + 'px';
      p.style.animationDuration = (Math.random() * 15 + 10) + 's';
      p.style.animationDelay = (Math.random() * 15) + 's';
      particleContainer.appendChild(p);
    }
  }

});
