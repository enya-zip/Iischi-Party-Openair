(() => {
  'use strict';
  let opener = null;
  document.querySelectorAll('[data-open]').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.open);
      if (!dialog) return;
      opener = button;
      document.dispatchEvent(new Event('iischi:pause'));
      dialog.showModal();
      document.body.style.overflow = 'hidden';
    });
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelectorAll('.close-dialog').forEach(button => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      document.body.style.overflow = '';
      if (opener) opener.focus({preventScroll:true});
    });
  });
})();
