let settingsModalInitialized = false;

export function setupSettingsModal() {
  if (settingsModalInitialized) return;
  settingsModalInitialized = true;

  const button = document.getElementById("settings-button");
  const modal = document.getElementById("settings-modal");
  if (!button || !modal) return;

  button.addEventListener("click", openSettingsModal);
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-settings-modal-close]")) closeSettingsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettingsModal();
  });
}

function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  const button = document.getElementById("settings-button");
  if (!modal) return;
  modal.hidden = false;
  button?.setAttribute("aria-expanded", "true");
  document.body.classList.add("modal-open");
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  const button = document.getElementById("settings-button");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("modal-open");
}
