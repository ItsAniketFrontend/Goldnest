/* ============================================================
   GoldNest – GSAP Animation Suite
   Cinematic gold-themed motion design
   ============================================================ */

(function () {
  'use strict';

  // Safety: if GSAP failed to load, unhide reveal classes so content is visible
  if (typeof window.gsap === 'undefined') {
    document.documentElement.classList.add('no-gsap');
    console.warn('[GoldNest] GSAP not loaded — falling back to static layout.');
    return;
  }

  if (typeof window.ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setupSplitText();
    setupHeroEntrance();
    setupGoldOrbMotion();
    setupGoldDust();
    setupScrollReveals();
    setupCounters();
    setupMagneticButtons();
    setupWhyCardShine();
    setupCursorSparkle();
    setupFloatingCards();
    setupTickerHover();

    // Re-measure triggers after layout settles (web fonts, images, GSAP setup)
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.refresh();
      window.addEventListener('load', () => ScrollTrigger.refresh());
      // Also refresh after fonts settle
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => ScrollTrigger.refresh());
      }
    }
  }

  /* ------------------------------------------------------------
     1. Split hero h1 into characters for cinematic reveal
  ------------------------------------------------------------ */
  function setupSplitText() {
    const targets = document.querySelectorAll('.hero-text h1');
    targets.forEach((el) => {
      // Avoid re-splitting if already done
      if (el.dataset.split === 'true') return;
      const wrap = document.createElement('div');
      wrap.innerHTML = el.innerHTML;
      const out = [];
      wrap.childNodes.forEach((node) => {
        if (node.nodeType === 3) {
          // Text node — split into WORDS, then wrap each char inside each word.
          // The .split-word wrapper has white-space: nowrap so a word never
          // breaks mid-character, even though characters animate individually.
          const text = node.textContent;
          const tokens = text.split(/(\s+)/); // captures whitespace runs
          for (const token of tokens) {
            if (!token) continue;
            if (/^\s+$/.test(token)) {
              out.push(token); // preserve original whitespace between words
            } else {
              let chars = '';
              for (const ch of token) {
                chars += `<span class="split-char">${ch}</span>`;
              }
              out.push(`<span class="split-word">${chars}</span>`);
            }
          }
        } else if (node.nodeType === 1) {
          // Element node (e.g., .highlight gradient span) — keep its inner HTML
          // intact so background-clip: text continues to work, and wrap it as
          // a single split-word so it never breaks internally.
          const cls = (node.className || '').trim();
          const inner = node.innerHTML;
          out.push(`<span class="split-word split-char ${cls}">${inner}</span>`);
        }
      });
      el.innerHTML = out.join('');
      el.dataset.split = 'true';
    });
  }

  /* ------------------------------------------------------------
     2. Hero entrance timeline
  ------------------------------------------------------------ */
  function setupHeroEntrance() {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.from('.hero-text .eyebrow', {
      y: 30, opacity: 0, duration: 0.7
    });

    tl.to('.hero-text h1 .split-char', {
      y: 0, opacity: 1,
      duration: 0.8,
      stagger: 0.025,
      ease: 'power4.out'
    }, '-=0.3');

    tl.from('.hero-text .desc', {
      y: 24, opacity: 0, duration: 0.7
    }, '-=0.6');

    tl.from('.hero-actions .btn', {
      y: 20, opacity: 0, duration: 0.6, stagger: 0.12,
      ease: 'back.out(1.6)'
    }, '-=0.4');

    tl.from('.hero-trust .trust-item', {
      y: 20, opacity: 0, duration: 0.5, stagger: 0.08
    }, '-=0.3');

    tl.from('.hero-visual', {
      scale: 0.8, opacity: 0, duration: 1.1, ease: 'expo.out'
    }, '-=1.2');

    tl.from('.floating-card', {
      y: 30, opacity: 0, duration: 0.7, stagger: 0.15,
      ease: 'back.out(1.4)'
    }, '-=0.8');
  }

  /* ------------------------------------------------------------
     3. Hero visual – coin parallax + scroll motion
  ------------------------------------------------------------ */
  function setupGoldOrbMotion() {
    const stage = document.querySelector('.coin-stage') || document.querySelector('.gold-orb');
    if (!stage) return;
    const coin = stage.querySelector('.coin-img');

    // Subtle bob on the price-tag
    gsap.to('.orb-center .price-tag', {
      y: -5,
      duration: 2.6,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });

    // Parallax on mousemove (desktop only)
    if (window.matchMedia('(min-width: 769px)').matches) {
      const heroVisual = document.querySelector('.hero-visual');
      if (heroVisual) {
        heroVisual.addEventListener('mousemove', (e) => {
          const rect = heroVisual.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width - 0.5;
          const y = (e.clientY - rect.top)  / rect.height - 0.5;
          if (coin) {
            /* keep the GIF a flat 2D translation — no 3D rotation so the bitmap stays sharp */
            gsap.to(coin, {
              x: x * 22, y: y * 22,
              duration: 1.2, ease: 'power3.out'
            });
          }
          gsap.to('.coin-rings', {
            x: x * 14, y: y * 14,
            rotateX: -y * 10, rotateY: x * 10,
            duration: 1.4, ease: 'power3.out',
            transformPerspective: 1000
          });
          gsap.to('.floating-card.fc1', { x: x * 36, y: y * 36, duration: 1.2, ease: 'power3.out' });
          gsap.to('.floating-card.fc2', { x: -x * 30, y: -y * 30, duration: 1.2, ease: 'power3.out' });
        });
        heroVisual.addEventListener('mouseleave', () => {
          if (coin) gsap.to(coin, { x: 0, y: 0, duration: 1, ease: 'power3.out' });
          gsap.to('.coin-rings', { x: 0, y: 0, rotateX: 0, rotateY: 0, duration: 1, ease: 'power3.out' });
          gsap.to('.floating-card', { x: 0, y: 0, duration: 1, ease: 'power3.out' });
        });
      }
    }

    // Scroll parallax: visual drifts up + scales as page scrolls
    if (typeof ScrollTrigger !== 'undefined') {
      gsap.to('.hero-visual', {
        y: -80,
        scale: 0.92,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero',
          start: 'top top',
          end: 'bottom top',
          scrub: 0.8
        }
      });
    }
  }

  /* ------------------------------------------------------------
     4. Gold dust particles – floating sparkles
  ------------------------------------------------------------ */
  function setupGoldDust() {
    let container = document.querySelector('.gold-dust');
    if (!container) {
      container = document.createElement('div');
      container.className = 'gold-dust';
      document.body.appendChild(container);
    }

    const COUNT = window.innerWidth < 768 ? 15 : 28;

    for (let i = 0; i < COUNT; i++) {
      const p = document.createElement('div');
      p.className = 'dust-particle';
      const size = Math.random() * 4 + 2;
      p.style.width = p.style.height = size + 'px';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.top  = Math.random() * 100 + 'vh';
      container.appendChild(p);

      animateDust(p);
    }
  }

  function animateDust(el) {
    const dur  = 8 + Math.random() * 14;
    const driftX = (Math.random() - 0.5) * 200;
    const driftY = -(window.innerHeight + 200);

    gsap.set(el, {
      opacity: 0,
      x: 0, y: 0,
      scale: Math.random() * 0.8 + 0.4
    });

    gsap.to(el, {
      opacity: 0.7,
      duration: 1.5,
      delay: Math.random() * 5,
      ease: 'sine.inOut'
    });

    gsap.to(el, {
      x: driftX,
      y: driftY,
      duration: dur,
      delay: Math.random() * 5,
      ease: 'none',
      onComplete: () => {
        el.style.left = Math.random() * 100 + 'vw';
        el.style.top  = '110vh';
        animateDust(el);
      }
    });

    // Twinkle
    gsap.to(el, {
      opacity: 0.2,
      duration: 1 + Math.random() * 2,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: Math.random() * 3
    });
  }

  /* ------------------------------------------------------------
     5. Scroll reveals — safe pattern
     - fromTo + immediateRender:false → element is NEVER hidden
       until trigger fires; if trigger fails, element stays visible.
     - once:true → animation fires only once.
  ------------------------------------------------------------ */
  function reveal(selector, fromVars, opts) {
    if (typeof ScrollTrigger === 'undefined') return;
    const els = gsap.utils.toArray(selector);
    if (!els.length) return;
    const baseTrigger = opts && opts.commonTrigger ? opts.commonTrigger : null;

    els.forEach((el, i) => {
      const trigger = baseTrigger || el;
      const delay = (opts && opts.stagger) ? i * opts.stagger : 0;
      gsap.fromTo(el,
        fromVars,
        {
          x: 0, y: 0, scale: 1, opacity: 1,
          duration: (opts && opts.duration) || 0.4,
          delay,
          ease: (opts && opts.ease) || 'power2.out',
          immediateRender: false,
          scrollTrigger: {
            trigger,
            start: (opts && opts.start) || 'top 98%',
            toggleActions: 'play none none none',
            once: true
          }
        }
      );
    });
  }

  function setupScrollReveals() {
    if (typeof ScrollTrigger === 'undefined') return;

    // Section headings — quick reveal
    gsap.utils.toArray('.section-heading').forEach((heading) => {
      gsap.fromTo(heading.children,
        { y: 18, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.4, stagger: 0.05, ease: 'power2.out',
          immediateRender: false,
          scrollTrigger: { trigger: heading, start: 'top 95%', once: true }
        }
      );
    });

    reveal('.why-card',       { y: 28, opacity: 0 }, { stagger: 0.04, start: 'top 98%' });
    reveal('.service-card',   { y: 28, opacity: 0, scale: 0.98 }, { stagger: 0.04, start: 'top 98%' });
    reveal('.stat-item',      { y: 18, opacity: 0 }, { stagger: 0.05, commonTrigger: '.stats-section', start: 'top 92%' });
    reveal('.step-item',      { y: 24, opacity: 0 }, { stagger: 0.06, ease: 'back.out(1.4)', commonTrigger: '.steps-wrapper', start: 'top 95%' });
    reveal('.testi-card',     { y: 22, opacity: 0 }, { stagger: 0.05, start: 'top 98%' });
    reveal('.blog-card',      { y: 24, opacity: 0 }, { stagger: 0.05, start: 'top 98%' });
    reveal('.partner-logo',   { y: 14, opacity: 0 }, { stagger: 0.03, commonTrigger: '.partners-section', start: 'top 98%' });
    reveal('.footer-grid > *',{ y: 18, opacity: 0 }, { stagger: 0.05, commonTrigger: '.footer', start: 'top 95%' });

    // App section split layout
    gsap.fromTo('.app-mockup',
      { x: -30, opacity: 0 },
      {
        x: 0, opacity: 1, duration: 0.5, ease: 'power2.out',
        immediateRender: false,
        scrollTrigger: { trigger: '.app-section', start: 'top 85%', once: true }
      }
    );
    gsap.fromTo('.app-section .app-feature',
      { x: 20, opacity: 0 },
      {
        x: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'power2.out',
        immediateRender: false,
        scrollTrigger: { trigger: '.app-features', start: 'top 92%', once: true }
      }
    );

    // CTA pop
    gsap.fromTo('.cta-section h2, .cta-section p, .cta-btns',
      { y: 18, opacity: 0 },
      {
        y: 0, opacity: 1, duration: 0.45, stagger: 0.06, ease: 'power2.out',
        immediateRender: false,
        scrollTrigger: { trigger: '.cta-section', start: 'top 90%', once: true }
      }
    );
  }

  /* ------------------------------------------------------------
     6. Animated counters using GSAP
  ------------------------------------------------------------ */
  function setupCounters() {
    if (typeof ScrollTrigger === 'undefined') return;
    document.querySelectorAll('[data-count]').forEach((el) => {
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      const prefix = el.dataset.prefix || '';
      const decimals = parseInt(el.dataset.decimals || '0', 10);
      const obj = { val: 0 };

      ScrollTrigger.create({
        trigger: el,
        start: 'top 95%',
        once: true,
        onEnter: () => {
          gsap.to(obj, {
            val: target,
            duration: 1.2,
            ease: 'power2.out',
            onUpdate: () => {
              el.textContent = prefix + obj.val.toFixed(decimals) + suffix;
            }
          });
        }
      });
    });
  }

  /* ------------------------------------------------------------
     7. Magnetic buttons – follow cursor slightly
  ------------------------------------------------------------ */
  function setupMagneticButtons() {
    if (!window.matchMedia('(min-width: 769px)').matches) return;
    document.querySelectorAll('.btn-gold, .btn-outline').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top  - r.height / 2;
        gsap.to(btn, { x: x * 0.25, y: y * 0.4, duration: 0.4, ease: 'power3.out' });
      });
      btn.addEventListener('mouseleave', () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
      });
    });
  }

  /* ------------------------------------------------------------
     8. Why-card shine that follows cursor
  ------------------------------------------------------------ */
  function setupWhyCardShine() {
    document.querySelectorAll('.why-card').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const mx = ((e.clientX - r.left) / r.width) * 100;
        const my = ((e.clientY - r.top)  / r.height) * 100;
        card.style.setProperty('--mx', mx + '%');
        card.style.setProperty('--my', my + '%');
      });
    });
  }

  /* ------------------------------------------------------------
     9. Cursor sparkle trail – tiny gold dots following cursor
  ------------------------------------------------------------ */
  function setupCursorSparkle() {
    if (!window.matchMedia('(min-width: 1024px)').matches) return;

    let last = 0;
    document.addEventListener('mousemove', (e) => {
      const now = performance.now();
      if (now - last < 60) return; // throttle
      last = now;

      const dot = document.createElement('div');
      dot.className = 'cursor-sparkle';
      dot.style.left = (e.clientX - 3) + 'px';
      dot.style.top  = (e.clientY - 3) + 'px';
      document.body.appendChild(dot);

      gsap.fromTo(dot,
        { opacity: 0.9, scale: 1 },
        {
          opacity: 0,
          scale: 0.2,
          y: '+=' + (10 + Math.random() * 14),
          x: '+=' + ((Math.random() - 0.5) * 20),
          duration: 0.9,
          ease: 'power2.out',
          onComplete: () => dot.remove()
        }
      );
    });
  }

  /* ------------------------------------------------------------
    10. Floating cards – gentle continuous motion
  ------------------------------------------------------------ */
  function setupFloatingCards() {
    gsap.to('.floating-card.fc1', {
      y: -10, duration: 2.6,
      yoyo: true, repeat: -1, ease: 'sine.inOut'
    });
    gsap.to('.floating-card.fc2', {
      y: 10, duration: 3.2,
      yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.6
    });
  }

  /* ------------------------------------------------------------
    11. Ticker hover pause + smooth speed
  ------------------------------------------------------------ */
  function setupTickerHover() {
    const track = document.querySelector('.ticker-track');
    if (!track) return;
    const ticker = track.parentElement;
    ticker.addEventListener('mouseenter', () => {
      gsap.to(track, { timeScale: 0.3, duration: 0.5 });
    });
    ticker.addEventListener('mouseleave', () => {
      gsap.to(track, { timeScale: 1, duration: 0.5 });
    });
  }

})();
