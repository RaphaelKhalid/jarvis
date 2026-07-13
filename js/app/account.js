// Account surface: a top-bar chip + a passwordless magic-link modal. Cookieless,
// minimal, in the Lab-Instrument system. Signed-out shows "Sign in"; signed-in
// shows the email + a tier dot and a small popover to sign out. Sync side-effects
// are the caller's job (onSignIn/onSignOut) — this module only owns the UI + auth.
import { cloudEnabled, onAuth, signInWithEmail, signOut } from './cloud.js';

export function initAccount({ onSignIn, onSignOut, onClassroom } = {}) {
  if (!cloudEnabled()) return { signOut: async () => {} };

  const topbar = document.getElementById('topbar');
  const chip = document.createElement('button');
  chip.id = 'account-chip';
  chip.type = 'button';
  chip.className = 'tb-account';
  chip.textContent = 'Sign in';
  chip.setAttribute('aria-label', 'Account');
  topbar.appendChild(chip);

  // ── magic-link modal ──
  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.className = 'hidden';
  modal.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-h">
      <button class="auth-close" type="button" aria-label="Close">✕</button>
      <div class="auth-mark" aria-hidden="true">◐</div>
      <h2 id="auth-h">Sync your bench</h2>
      <p>Your builds and lesson progress follow you to any device. We’ll email a magic link — no password.</p>
      <form id="auth-form" novalidate>
        <label class="auth-label" for="auth-email">Email</label>
        <input id="auth-email" type="email" inputmode="email" autocomplete="email" required placeholder="you@example.com">
        <button type="submit" class="auth-submit">Send magic link</button>
      </form>
      <div id="auth-msg" class="auth-msg" role="status" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(modal);

  const emailInput = modal.querySelector('#auth-email');
  const msgEl = modal.querySelector('#auth-msg');
  let lastFocus = null;

  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.remove('hidden');
    msgEl.textContent = ''; msgEl.classList.remove('err');
    emailInput.focus();
  }
  function closeModal() {
    modal.classList.add('hidden');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  modal.querySelector('.auth-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  modal.querySelector('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) { msgEl.textContent = 'Enter your email.'; msgEl.classList.add('err'); return; }
    msgEl.classList.remove('err');
    msgEl.textContent = 'Sending…';
    const { error } = await signInWithEmail(email);
    if (error) { msgEl.textContent = `Couldn’t send the link: ${error}`; msgEl.classList.add('err'); }
    else { msgEl.textContent = 'Check your inbox for the magic link ✉'; }
  });

  // ── signed-in popover ──
  let popover = null;
  let currentUser = null;
  function closePopover() { if (popover) { popover.remove(); popover = null; } }
  function openPopover() {
    closePopover();
    popover = document.createElement('div');
    popover.className = 'acc-popover';
    popover.innerHTML = `
      <div class="acc-email">${currentUser.email || 'Signed in'}</div>
      <div class="acc-plan">You’re on <b>Free</b></div>
      <button class="acc-classroom" type="button">Classroom</button>
      <button class="acc-signout" type="button">Sign out</button>`;
    topbar.appendChild(popover);
    popover.querySelector('.acc-classroom').addEventListener('click', () => { closePopover(); onClassroom?.(); });
    popover.querySelector('.acc-signout').addEventListener('click', async () => {
      closePopover(); await signOut();
    });
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }
  function onDocClick(e) {
    if (popover && !popover.contains(e.target) && e.target !== chip) { closePopover(); document.removeEventListener('click', onDocClick); }
  }

  chip.addEventListener('click', () => {
    if (currentUser) { popover ? closePopover() : openPopover(); }
    else openModal();
  });

  function renderChip(user) {
    currentUser = user;
    closePopover();
    if (user) {
      chip.classList.add('signed-in');
      chip.innerHTML = `<span class="acc-dot" title="Free"></span><span class="acc-name">${user.email}</span>`;
    } else {
      chip.classList.remove('signed-in');
      chip.textContent = 'Sign in';
    }
  }

  onAuth((user) => {
    renderChip(user);
    if (user) { closeModal(); onSignIn?.(user); }
    else { onSignOut?.(); }
  });

  return { signOut: async () => { await signOut(); } };
}
