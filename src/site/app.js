const address = document.getElementById('manifest-address');
const status = document.getElementById('copy-status');
address.value = document.getElementById('manifest').href;

document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(address.value);
    status.textContent = 'Adresse copiée.';
  } catch {
    address.focus();
    address.select();
    status.textContent = 'Adresse sélectionnée. Copie-la avec ton clavier.';
  }
});

const service = document.getElementById('service');
try {
  const response = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Service indisponible');
  service.dataset.state = 'online';
  service.textContent = 'En ligne';
} catch {
  service.dataset.state = 'offline';
  service.textContent = 'Indisponible';
}
