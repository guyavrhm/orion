import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { MediaCard } from '../components/MediaCard.js';

class SearchView {
  constructor() {
    this.searchInput = null;
    this.searchBtn = null;
    this.resultsGrid = null;
    this.loader = null;
    this.filterContainer = null;
    this.filterPills = [];
    this.searchTimeout = null;
    this.currentResults = [];
    this.currentFilter = 'movie';
    this.lastQuery = '';
  }

  init() {
    this.searchInput = document.getElementById('big-search-input');
    this.searchBtn = document.getElementById('big-search-btn');
    this.resultsGrid = document.getElementById('search-results-grid');
    this.loader = document.getElementById('search-loader');
    this.filterContainer = document.getElementById('search-filter-container');
    this.filterPills = Array.from(document.querySelectorAll('.search-filter-pill'));

    if (!this.searchInput) return;

    // Filter pill interactions
    this.filterPills.forEach(pill => {
      pill.onclick = () => {
        const filter = pill.dataset.filter;
        if (this.currentFilter === filter) return;
        this.setFilter(filter);
      };
      pill.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pill.click();
        }
      };
    });

    this.searchBtn.onclick = () => {
      this.triggerSearch();
      this.searchInput.blur();
    };

    this.searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.triggerSearch();
        this.searchInput.blur();
      }
    };

    this.searchInput.oninput = (e) => {
      const query = e.target.value.trim();
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      if (query.length === 0) {
        this.clearResults();
        return;
      }
      this.searchTimeout = setTimeout(() => {
        this.executeSearch(query);
      }, 2000);
    };

    // Keep mobile viewport stable on focus/blur
    this.searchInput.addEventListener('focus', () => {
      setTimeout(() => {
        if (window.scrollY > 0 && window.scrollY < 120) {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      }, 50);
    });

    this.searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (window.scrollY > 0 && window.scrollY < 120) {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      }, 100);
    });

    // Dismiss keyboard on scroll or touch drag so scrolling behaves identically to when keyboard is inactive
    const dismissKeyboard = () => {
      if (document.activeElement === this.searchInput) {
        this.searchInput.blur();
      }
    };

    window.addEventListener('scroll', dismissKeyboard, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (document.activeElement === this.searchInput) {
        dismissKeyboard();
      }
    }, { passive: true });

    const searchPage = document.getElementById('search-page');
    if (searchPage) {
      searchPage.addEventListener('touchstart', (e) => {
        if (document.activeElement === this.searchInput && e.target !== this.searchInput && e.target !== this.searchBtn && !this.searchBtn?.contains(e.target)) {
          dismissKeyboard();
        }
      }, { passive: true });
    }
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.filterPills.forEach(pill => {
      if (pill.dataset.filter === filter) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
    this.renderFilteredResults();
  }

  clearResults() {
    if (this.resultsGrid) this.resultsGrid.innerHTML = '';
    this.currentResults = [];
    if (this.filterContainer) this.filterContainer.style.display = 'none';
  }

  async triggerSearch() {
    const query = this.searchInput.value.trim();
    if (query.length > 0) {
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      await this.executeSearch(query);
    }
  }

  async executeSearch(query) {
    if (!this.resultsGrid) return;
    this.lastQuery = query;
    this.resultsGrid.innerHTML = '';
    if (this.filterContainer) this.filterContainer.style.display = 'none';
    this.loader.style.display = 'flex';

    try {
      const response = await apiService.performSearch(query);
      this.loader.style.display = 'none';
      const results = response.metadata || [];
      const filtered = results.filter(item => item.type === 'movie' || item.type === 'series');
      this.currentResults = filtered;

      if (filtered.length === 0) {
        this.resultsGrid.innerHTML = '<div style="grid-column:1 / -1; display:flex; align-items:center; justify-content:center; text-align:center; width:100%; height:12rem; color:#888; font-size:0.95rem;">No results found.</div>';
        return;
      }

      // Update pill counts
      const moviesCount = filtered.filter(item => item.type === 'movie').length;
      const showsCount = filtered.filter(item => item.type === 'series').length;

      const pillMovies = document.getElementById('search-filter-movies');
      const pillShows = document.getElementById('search-filter-shows');

      if (pillMovies) pillMovies.innerHTML = `Movies <span class="filter-count">${moviesCount}</span>`;
      if (pillShows) pillShows.innerHTML = `Shows <span class="filter-count">${showsCount}</span>`;

      if (this.filterContainer) this.filterContainer.style.display = 'flex';
      this.renderFilteredResults();
    } catch (e) {
      console.error('[SearchView] Search failed:', e);
      this.loader.style.display = 'none';
      this.resultsGrid.innerHTML = '<div style="grid-column:1 / -1; display:flex; align-items:center; justify-content:center; text-align:center; width:100%; height:12rem; color:#888; font-size:0.95rem;">Error searching. Try again.</div>';
    }
  }

  renderFilteredResults() {
    this.resultsGrid.innerHTML = '';
    if (!this.currentResults || this.currentResults.length === 0) return;

    const movies = this.currentResults.filter(item => item.type === 'movie');
    const series = this.currentResults.filter(item => item.type === 'series');

    const renderCards = (items) => {
      items.forEach((item, index) => {
        const card = MediaCard.createSearchCard(item);
        this.resultsGrid.appendChild(card);
        setTimeout(() => {
          card.classList.add('fade-in');
        }, index * 25);
      });
    };

    if (this.currentFilter === 'movie') {
      if (movies.length === 0) {
        this.resultsGrid.innerHTML = '<div style="grid-column:1 / -1; display:flex; align-items:center; justify-content:center; text-align:center; width:100%; height:12rem; color:#888; font-size:0.95rem;">No movies found for this search.</div>';
      } else {
        renderCards(movies);
      }
    } else if (this.currentFilter === 'series') {
      if (series.length === 0) {
        this.resultsGrid.innerHTML = '<div style="grid-column:1 / -1; display:flex; align-items:center; justify-content:center; text-align:center; width:100%; height:12rem; color:#888; font-size:0.95rem;">No shows found for this search.</div>';
      } else {
        renderCards(series);
      }
    }
  }
}

export const searchView = new SearchView();
export default searchView;
