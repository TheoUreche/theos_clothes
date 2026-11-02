// Global state
const rawProducts = typeof PRODUCTS_DATA !== 'undefined' ? PRODUCTS_DATA : [];
const State = {
  // Initial cached available products
  products: rawProducts.filter(p => p.status === 'available'),
  filters: {
    category: 'all',
    designer: 'all',
    size: 'all',
    sort: 'featured',
    search: ''
  },
  wishlist: new Set(JSON.parse(localStorage.getItem('theos_wishlist') || '[]')),
  activeOfferProduct: null,
  isLiveSynced: false
};

// Algolia Live Sync config
const GRAILED_CONFIG = {
  appId: 'MNRWEFSS2Q',
  apiKey: 'bc9ee1c014521ccf312525a4ef324a16',
  endpoint: 'https://mnrwefss2q-dsn.algolia.net/1/indexes/Listing_production/query',
  userId: 14276964 // @theos_clothes Grailed user ID
};

// DOM Ready Initialization
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  applyFiltersAndRender();
  updateWishlistUI();
  
  // Sync with Grailed closet
  fetchGrailedLiveSync();
  // Poll every 60 seconds
  setInterval(fetchGrailedLiveSync, 60000);
});

// Inventory sync w grailed 
async function fetchGrailedLiveSync() {
  try {
    const response = await fetch(GRAILED_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'x-algolia-application-id': GRAILED_CONFIG.appId,
        'x-algolia-api-key': GRAILED_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: '',
        filters: `user.id = ${GRAILED_CONFIG.userId}`,
        hitsPerPage: 100
      })
    });

    if (!response.ok) return;

    const data = await response.json();
    const hits = data.hits || [];

    if (hits && hits.length > 0) {
      // Map live grailed hits to product schem
      const liveProducts = hits.map(hit => {
        const price = hit.price || 0;
        const origPrice = hit.original_price || price;
        const hasDrop = (price < origPrice);
        const designer = hit.designer_names || (hit.designers && hit.designers[0] && hit.designers[0].name) || 'Designer';
        const coverPhoto = hit.cover_photo ? hit.cover_photo.url : (hit.photo_urls && hit.photo_urls[0] ? hit.photo_urls[0] : '');

        return {
          id: hit.id,
          title: hit.title || 'Streetwear Piece',
          designer: designer,
          price: price,
          originalPrice: origPrice,
          hasPriceDrop: hasDrop,
          size: hit.size || 'M',
          category: (hit.category || hit.category_path || 'tops').toLowerCase(),
          color: hit.color || 'Black',
          condition: hit.condition || 'Gently Used',
          photoCount: hit.photo_count || (hit.photo_urls ? hit.photo_urls.length : 5),
          coverUrl: coverPhoto,
          localImage: `images/${hit.id}.jpg`,
          grailedUrl: `https://www.grailed.com/listings/${hit.id}`,
          status: 'available'
        };
      });

      // Update state with live inventory
      State.products = liveProducts;
      State.isLiveSynced = true;

      // ui live indicator update
      const countEl = document.getElementById('liveInventoryCount');
      if (countEl) {
        countEl.textContent = `${liveProducts.length} items`;
      }

      applyFiltersAndRender();
      console.log(`[Grailed Live Sync] Successfully synchronized ${liveProducts.length} active listings.`);
    }
  } catch (err) {
    console.warn('[Grailed Live Sync] Network error or offline, fallback to cached data.', err);
  }
}

function initEventListeners() {
  const searchToggleBtn = document.getElementById('searchToggleBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const globalSearchInput = document.getElementById('globalSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  searchToggleBtn?.addEventListener('click', () => {
    searchOverlay?.classList.toggle('hidden');
    if (!searchOverlay?.classList.contains('hidden')) {
      globalSearchInput?.focus();
    }
  });

  globalSearchInput?.addEventListener('input', (e) => {
    State.filters.search = e.target.value.trim().toLowerCase();
    applyFiltersAndRender();
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (globalSearchInput) globalSearchInput.value = '';
    State.filters.search = '';
    applyFiltersAndRender();
  });

  document.querySelectorAll('.quick-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag');
      if (globalSearchInput) globalSearchInput.value = tag;
      State.filters.search = tag.toLowerCase();
      applyFiltersAndRender();
      searchOverlay?.classList.remove('hidden');
    });
  });

  //category pills
  document.querySelectorAll('.category-pills .pill-btn').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.category-pills .pill-btn').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      State.filters.category = pill.getAttribute('data-category');
      applyFiltersAndRender();
    });
  });

  // Designer dropdown
  document.getElementById('designerSelect')?.addEventListener('change', (e) => {
    State.filters.designer = e.target.value;
    applyFiltersAndRender();
  });

  // Size dropdown
  document.getElementById('sizeSelect')?.addEventListener('change', (e) => {
    State.filters.size = e.target.value;
    applyFiltersAndRender();
  });

  // Sort dropdown
  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
    State.filters.sort = e.target.value;
    applyFiltersAndRender();
  });

  // Reset Filters button(s)
  document.getElementById('resetFiltersBtn')?.addEventListener('click', resetAllFilters);
  document.getElementById('clearAllFiltersLink')?.addEventListener('click', resetAllFilters);

  // Liked items header button
  document.getElementById('wishlistToggleBtn')?.addEventListener('click', () => {
    renderWishlistModal();
    document.getElementById('wishlistModal')?.showModal();
  });

  document.getElementById('closeWishlistBtn')?.addEventListener('click', () => {
    document.getElementById('wishlistModal')?.close();
  });

  // Quick view modal close
  document.getElementById('closeQuickViewBtn')?.addEventListener('click', () => {
    document.getElementById('quickViewModal')?.close();
  });

  // offermodal close
  document.getElementById('closeOfferBtn')?.addEventListener('click', () => {
    document.getElementById('offerModal')?.close();
  });

  document.querySelectorAll('.quick-pct-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!State.activeOfferProduct) return;
      const pct = parseInt(btn.getAttribute('data-pct'), 10);
      const originalPrice = State.activeOfferProduct.price;
      const offered = Math.round(originalPrice * (1 - pct / 100));
      const input = document.getElementById('offerAmountInput');
      if (input) input.value = offered;
      updateOfferSavingsHint(offered, originalPrice);
    });
  });

  document.getElementById('offerAmountInput')?.addEventListener('input', (e) => {
    if (!State.activeOfferProduct) return;
    const val = parseFloat(e.target.value) || 0;
    updateOfferSavingsHint(val, State.activeOfferProduct.price);
  });

  // dialog dismiss
  document.querySelectorAll('dialog.app-modal').forEach(dialog => {
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        dialog.close();
      }
    });
  });
}

function matchesCategory(product, cat) {
  if (cat === 'all') return true;
  const title = (product.title || '').toLowerCase();
  const cPath = (product.category || '').toLowerCase();

  switch (cat) {
    case 'tees':
      return title.includes('t shirt') || title.includes('tee') || title.includes('t-shirt') || cPath.includes('short_sleeve') || cPath.includes('tops');
    case 'hoodies':
      return title.includes('hoodie') || title.includes('sweatshirt') || title.includes('sweater') || cPath.includes('sweatshirts');
    case 'shorts':
      return title.includes('short') || title.includes('pant') || title.includes('jean') || title.includes('sweatpant') || cPath.includes('bottoms');
    case 'shirts':
      return title.includes('button up') || title.includes('button-up') || title.includes('button');
    case 'footwear':
      return title.includes('dunk') || title.includes('slipper') || title.includes('shoe') || title.includes('sneaker') || title.includes('lottery') || title.includes('jordan');
    default:
      return true;
  }
}

function matchesSize(product, size) {
  if (size === 'all') return true;
  const productSize = String(product.size || '').toUpperCase();
  if (size === '30') return productSize.includes('30') || productSize.includes('WAIST');
  if (size === '8') return productSize.includes('8') || productSize.includes('8.5');
  return productSize === size;
}

function filterAndSortProducts() {
  let list = State.products.filter(p => {
    // Category
    if (!matchesCategory(p, State.filters.category)) return false;

    // Designer
    if (State.filters.designer !== 'all') {
      const prodDesigner = (p.designer || '').toLowerCase();
      const targetDesigner = State.filters.designer.toLowerCase();
      if (!prodDesigner.includes(targetDesigner)) return false;
    }

    // Size
    if (!matchesSize(p, State.filters.size)) return false;

    // Search query
    if (State.filters.search) {
      const q = State.filters.search;
      const haystack = `${p.title} ${p.designer} ${p.color} ${p.size} ${p.condition}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  // Sorting
  switch (State.filters.sort) {
    case 'price-asc':
      list.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      list.sort((a, b) => b.price - a.price);
      break;
    case 'price-drop':
      list.sort((a, b) => {
        const dropA = a.hasPriceDrop ? (a.originalPrice - a.price) : 0;
        const dropB = b.hasPriceDrop ? (b.originalPrice - b.price) : 0;
        return dropB - dropA;
      });
      break;
    case 'featured':
    default:
      list.sort((a, b) => b.id - a.id);
      break;
  }

  return list;
}

// render grid
function applyFiltersAndRender() {
  const container = document.getElementById('productsGrid');
  const emptyState = document.getElementById('emptyState');
  const summaryBar = document.getElementById('filterSummaryBar');
  const summaryText = document.getElementById('filterSummaryText');

  if (!container) return;

  const filtered = filterAndSortProducts();

  const hasActiveFilter = (
    State.filters.category !== 'all' ||
    State.filters.designer !== 'all' ||
    State.filters.size !== 'all' ||
    Boolean(State.filters.search)
  );

  if (summaryBar && summaryText) {
    if (hasActiveFilter) {
      summaryBar.style.display = 'flex';
      summaryText.textContent = `${filtered.length} of ${State.products.length} items`;
    } else {
      summaryBar.style.display = 'none';
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = filtered.map(product => renderProductCard(product)).join('');
}

function renderProductCard(p) {
  const isWishlisted = State.wishlist.has(p.id);
  const discountAmt = (p.originalPrice && p.price && p.originalPrice > p.price) ? (p.originalPrice - p.price) : 0;
  const hasRealPriceDrop = Boolean(p.hasPriceDrop) && discountAmt > 0;

  // Primary image w fallback to coverUrl
  const imgSrc = p.localImage || p.coverUrl;
  const fallbackSrc = p.coverUrl || p.localImage;

  return `
    <article class="product-card" data-id="${p.id}">
      <div class="card-media" onclick="openQuickView(${p.id})">
        <img 
          src="${imgSrc}" 
          alt="${escapeHtml(p.title)}" 
          loading="lazy" 
          onerror="this.onerror=null; this.src='${fallbackSrc}';"
        />
        
        ${hasRealPriceDrop ? `
          <div class="card-badges">
            <span class="badge badge-drop">−$${discountAmt}</span>
          </div>
        ` : ''}

        <button
          class="wishlist-btn ${isWishlisted ? 'active' : ''}"
          title="${isWishlisted ? 'Remove from saved' : 'Save'}"
          onclick="event.stopPropagation(); toggleWishlist(${p.id})"
          aria-label="${isWishlisted ? 'Remove from saved' : 'Save'}"
        >
          <span class="material-symbols-outlined heart-icon">favorite</span>
        </button>

        <div class="card-quick-actions">
          <button class="btn-card-action" onclick="event.stopPropagation(); openOfferModal(${p.id})">Make Offer</button>
        </div>
      </div>

      <div class="card-content">
        <div class="card-designer">${escapeHtml(p.designer || 'Designer')}</div>
        <h3 class="card-title" title="${escapeHtml(p.title)}" onclick="openQuickView(${p.id})">
          ${escapeHtml(p.title)}
        </h3>

        <div class="card-tags">
          <span class="tag-pill">${escapeHtml(p.size)}</span>
          <span class="tag-pill">${escapeHtml(p.color)}</span>
          <span class="tag-pill">${escapeHtml(p.condition)}</span>
        </div>

        <div class="card-footer">
          <div class="price-box">
            <span class="current-price">$${p.price}</span>
            ${hasRealPriceDrop ? `<span class="original-price">$${p.originalPrice}</span>` : ''}
          </div>

          <a
            href="${p.grailedUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="card-btn-contact"
            onclick="event.stopPropagation();"
          >
            View <span class="material-symbols-outlined" style="font-size: 0.9rem;">arrow_outward</span>
          </a>
        </div>
      </div>
    </article>
  `;
}

// quickiew modal
function openQuickView(productId) {
  const product = State.products.find(p => p.id === productId);
  if (!product) return;

  const modal = document.getElementById('quickViewModal');
  if (!modal) return;

  const qvImage = document.getElementById('qvImage');
  const qvDesigner = document.getElementById('qvDesigner');
  const qvTitle = document.getElementById('qvTitle');
  const qvPrice = document.getElementById('qvPrice');
  const qvOriginalPrice = document.getElementById('qvOriginalPrice');
  const qvDiscountTag = document.getElementById('qvDiscountTag');
  const qvSize = document.getElementById('qvSize');
  const qvCondition = document.getElementById('qvCondition');
  const qvColor = document.getElementById('qvColor');
  const qvPhotoCount = document.getElementById('qvPhotoCount');
  const qvBadges = document.getElementById('qvBadges');
  const qvContactBtn = document.getElementById('qvContactBtn');
  const qvMakeOfferBtn = document.getElementById('qvMakeOfferBtn');

  const imgSrc = product.localImage || product.coverUrl;

  if (qvImage) {
    qvImage.src = imgSrc;
    qvImage.onerror = () => { qvImage.src = product.coverUrl; };
  }
  if (qvDesigner) qvDesigner.textContent = product.designer;
  if (qvTitle) qvTitle.textContent = product.title;
  if (qvPrice) qvPrice.textContent = `$${product.price}`;
  
  const discountAmt = (product.originalPrice && product.price && product.originalPrice > product.price) ? (product.originalPrice - product.price) : 0;
  const hasRealPriceDrop = Boolean(product.hasPriceDrop) && discountAmt > 0;

  if (qvOriginalPrice) {
    if (hasRealPriceDrop) {
      qvOriginalPrice.style.display = 'inline';
      qvOriginalPrice.textContent = `$${product.originalPrice}`;
    } else {
      qvOriginalPrice.style.display = 'none';
    }
  }

  if (qvDiscountTag) {
    if (hasRealPriceDrop) {
      qvDiscountTag.style.display = 'inline-block';
      qvDiscountTag.textContent = `$${discountAmt} off`;
    } else {
      qvDiscountTag.style.display = 'none';
    }
  }

  if (qvSize) qvSize.textContent = product.size;
  if (qvCondition) qvCondition.textContent = product.condition;
  if (qvColor) qvColor.textContent = product.color;
  if (qvPhotoCount) qvPhotoCount.textContent = `${product.photoCount || 5} photos`;
  if (qvImage) qvImage.alt = product.title;
  if (qvBadges) qvBadges.innerHTML = '';
  if (qvContactBtn) {
    qvContactBtn.href = product.grailedUrl;
  }

  if (qvMakeOfferBtn) {
    qvMakeOfferBtn.onclick = () => {
      modal.close();
      openOfferModal(product.id);
    };
  }

  modal.showModal();
}

// offer modal
function openOfferModal(productId) {
  const product = State.products.find(p => p.id === productId);
  if (!product) return;

  State.activeOfferProduct = product;
  const modal = document.getElementById('offerModal');
  if (!modal) return;

  const img = document.getElementById('offerItemImg');
  const brand = document.getElementById('offerItemDesigner');
  const title = document.getElementById('offerItemTitle');
  const price = document.getElementById('offerItemPrice');
  const amountInput = document.getElementById('offerAmountInput');

  const imgSrc = product.localImage || product.coverUrl;
  if (img) {
    img.src = imgSrc;
    img.onerror = () => { img.src = product.coverUrl; };
  }
  if (brand) brand.textContent = product.designer;
  if (title) title.textContent = product.title;
  if (price) price.textContent = `$${product.price}`;

  const defaultOffer = Math.round(product.price * 0.85);
  if (amountInput) amountInput.value = defaultOffer;
  updateOfferSavingsHint(defaultOffer, product.price);

  modal.showModal();
}

function updateOfferSavingsHint(offered, asking) {
  const hint = document.getElementById('offerSavingsHint');
  if (!hint) return;

  if (offered >= asking) {
    hint.textContent = 'At or above asking price.';
    hint.style.color = 'var(--success)';
  } else if (offered <= asking * 0.5) {
    hint.textContent = 'Offers below 50% of asking are unlikely to be accepted.';
    hint.style.color = 'var(--danger)';
  } else {
    const savings = asking - offered;
    const pct = Math.round((savings / asking) * 100);
    hint.textContent = `$${savings} below asking (${pct}%)`;
    hint.style.color = 'var(--success)';
  }
}

async function submitOffer(e) {
  e.preventDefault();
  if (!State.activeOfferProduct) return;

  const product = State.activeOfferProduct;
  const amount = parseFloat(document.getElementById('offerAmountInput')?.value) || 0;
  const emailInput = document.getElementById('offerEmailInput');
  const noteInput = document.getElementById('offerNoteInput');
  const email = emailInput?.value.trim() || '';
  const note = noteInput?.value.trim() || '';

  if (amount <= 0) {
    showToast('Enter a valid offer amount.', 'warning');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showToast('Enter a valid email address.', 'warning');
    emailInput?.focus();
    return;
  }

  const form = document.getElementById('offerForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  const originalBtnHtml = submitBtn?.innerHTML || 'Submit Offer';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Sending…';
  }

  // email offer to Theo -> FormSubmit sends automatic confirm. to buyer 
  try {
    const payload = {
      email: email,
      _replyto: email,
      _subject: `New Offer: $${amount} on ${product.designer} - ${product.title}`,
      Item_Title: product.title,
      Designer: product.designer,
      Asking_Price: `$${product.price}`,
      Offered_Amount: `$${amount}`,
      Buyer_Email: email,
      Buyer_Note: note || 'None',
      Listing_Link: product.grailedUrl,
      _autoresponse: `Your offer of $${amount} on the ${product.designer} ${product.title} has been received. I'll reply to this address shortly.\n\nTheo Ureche\nTheo's Clothes`,
      _template: 'table'
    };

    const res = await fetch('https://formsubmit.co/ajax/theo.u@hotmail.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    document.getElementById('offerModal')?.close();
    showToast(`Offer of $${amount} sent. Confirmation sent to ${email}.`, 'success');
    if (form) form.reset();
    State.activeOfferProduct = null;
  } catch (err) {
    showToast('Offer not sent. Please try again.', 'warning');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }
}

// newsletter useless signup- email conf
window.handleNewsletter = async function(e) {
  e.preventDefault();
  const form = e.target;
  const input = form.querySelector('input[type="email"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  if (!input || !input.value) return;

  const email = input.value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showToast('Enter a valid email address.', 'warning');
    return;
  }

  const origBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = 'Sending…';

  try {
    const payload = {
      email: email,
      _replyto: email,
      _subject: "New subscriber: Theo's Clothes",
      Subscriber_Email: email,
      _autoresponse: `Thank you for subscribing! You'll get an email when new items are listed.\n\nTheo Ureche\nTheo's Clothes`,
      _template: 'table'
    };

    const res = await fetch('https://formsubmit.co/ajax/theo.u@hotmail.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    showToast('Subscribed.', 'success');
    form.reset();
  } catch (err) {
    showToast('Subscription failed. Please try again.', 'warning');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = origBtnText;
  }
};

// liked items wishlist
function toggleWishlist(productId) {
  if (State.wishlist.has(productId)) {
    State.wishlist.delete(productId);
    showToast('Removed from saved.', 'info');
  } else {
    State.wishlist.add(productId);
    showToast('Saved.', 'success');
  }

  localStorage.setItem('theos_wishlist', JSON.stringify(Array.from(State.wishlist)));
  updateWishlistUI();
  applyFiltersAndRender();

  // refresh WL modal if open
  const modal = document.getElementById('wishlistModal');
  if (modal && modal.open) {
    renderWishlistModal();
  }
}
function updateWishlistUI() {
  const countEl = document.querySelector('.wishlist-count');
  if (countEl) {
    const count = State.wishlist.size;
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'flex' : 'none';
  }
}
function renderWishlistModal() {
  const container = document.getElementById('wishlistItemsContainer');
  const emptyView = document.getElementById('wishlistEmptyView');
  if (!container || !emptyView) return;

  const likedProducts = State.products.filter(p => State.wishlist.has(p.id));

  if (likedProducts.length === 0) {
    container.innerHTML = '';
    emptyView.style.display = 'block';
    return;
  }

  emptyView.style.display = 'none';
  container.innerHTML = likedProducts.map(p => `
    <div class="wishlist-item-row">
      <img src="${p.localImage || p.coverUrl}" alt="${escapeHtml(p.title)}" class="wishlist-item-thumb" />
      <div class="wishlist-item-info">
        <div class="wishlist-item-designer">${escapeHtml(p.designer)}</div>
        <div class="wishlist-item-title">${escapeHtml(p.title)}</div>
        <div class="wishlist-item-price">$${p.price}</div>
      </div>
      <div class="wishlist-item-actions">
        <a 
          href="${p.grailedUrl}" 
          target="_blank" 
          rel="noopener noreferrer" 
          class="btn btn-sm btn-primary"
        >View</a>
        <button
          class="btn btn-sm btn-ghost"
          onclick="toggleWishlist(${p.id})"
          title="Remove"
          aria-label="Remove"
        >
          <span class="material-symbols-outlined" style="font-size: 0.95rem;">close</span>
        </button>
      </div>
    </div>
  `).join('');
}

// quick filter sc
window.filterByDesigner = function(designerName) {
  const select = document.getElementById('designerSelect');
  if (select) select.value = designerName;
  State.filters.designer = designerName;

  applyFiltersAndRender();
  document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
};

window.resetAllFilters = function() {
  State.filters = {
    category: 'all',
    designer: 'all',
    size: 'all',
    sort: 'featured',
    search: ''
  };

  const searchInput = document.getElementById('globalSearchInput');
  const designerSelect = document.getElementById('designerSelect');
  const sizeSelect = document.getElementById('sizeSelect');
  const sortSelect = document.getElementById('sortSelect');

  if (searchInput) searchInput.value = '';
  if (designerSelect) designerSelect.value = 'all';
  if (sizeSelect) sizeSelect.value = 'all';
  if (sortSelect) sortSelect.value = 'featured';

  document.querySelectorAll('.category-pills .pill-btn').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-category') === 'all');
  });

  applyFiltersAndRender();
  showToast('Filters cleared.', 'info');
};

// toast sys
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = '<span class="material-symbols-outlined" style="font-size: 1.1rem; color: #cfc5b8;">info</span>';
  if (type === 'success') icon = '<span class="material-symbols-outlined" style="font-size: 1.1rem; color: #9fb59f;">check_circle</span>';
  if (type === 'warning') icon = '<span class="material-symbols-outlined" style="font-size: 1.1rem; color: #d9a35c;">error</span>';

  toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
