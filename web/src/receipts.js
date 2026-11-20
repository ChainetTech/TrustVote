// Receipts are kept in this browser and can be downloaded. A receipt is the
// server's signature on "entry #N has hash H". If the server ever removes or
// changes that entry, the receipt proves it.

const KEY = 'trustvote:receipts';

export function loadReceipts() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveReceipt(receipt) {
  try {
    const list = loadReceipts().filter((r) => !(r.seq === receipt.seq && r.hash === receipt.hash));
    list.push(receipt);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode): the download button still works */
  }
}

export function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const receiptFilename = (r) => `trustvote-receipt-${r.seq}.json`;
