import { store } from '../state/Store.js';

class NavBar {
  constructor() {
    this.navSearch = null;
    this.navMovies = null;
    this.navShows = null;
    this.searchPage = null;
    this.browsePage = null;
    this.bigSearchInput = null;
  }

  init(initialPage = 'movies') {
    this.navSearch = document.getElementById('nav-search');
    this.navMovies = document.getElementById('nav-movies');
    this.navShows = document.getElementById('nav-shows');
    
    this.searchPage = document.getElementById('search-page');
    this.browsePage = document.getElementById('browse-page');
    this.bigSearchInput = document.getElementById('big-search-input');

    if (!this.navSearch || !this.navMovies || !this.navShows) return;

    this.navSearch.onclick = () => this.navigateToTab('search');
    this.navMovies.onclick = () => this.navigateToTab('movies');
    this.navShows.onclick = () => this.navigateToTab('shows');

    store.subscribe((changeType, state) => {
      if (changeType === 'page-changed') {
        this.syncTabs(state.currentPage);
      }
    });

    this.syncTabs(initialPage);
  }

  navigateToTab(tabName) {
    if (store.state.currentPage === tabName) return;
    store.updateState({ currentPage: tabName }, 'page-changed');
  }

  syncTabs(page) {
    if (!this.navSearch || !this.navMovies || !this.navShows) return;
    
    const tabs = [this.navSearch, this.navMovies, this.navShows];
    tabs.forEach(el => el && el.classList.remove('active'));
    
    if (page === 'search') {
      if (this.navSearch) this.navSearch.classList.add('active');
      if (this.searchPage) {
        this.searchPage.style.display = 'block';
        this.searchPage.classList.remove('fade-in-page');
        void this.searchPage.offsetWidth; // trigger reflow
        this.searchPage.classList.add('fade-in-page');
      }
      if (this.browsePage) this.browsePage.style.display = 'none';
      if (this.bigSearchInput) {
        const isMobile = window.matchMedia('(max-width: 64rem) and (orientation: portrait), (max-width: 48rem)').matches;
        if (!isMobile) {
          this.bigSearchInput.focus({ preventScroll: true });
        }
      }
    } else {
      if (page === 'movies' && this.navMovies) this.navMovies.classList.add('active');
      if (page === 'shows' && this.navShows) this.navShows.classList.add('active');
      if (this.searchPage) this.searchPage.style.display = 'none';
      if (this.browsePage) {
        this.browsePage.style.display = 'block';
        this.browsePage.classList.remove('fade-in-page');
        void this.browsePage.offsetWidth; // trigger reflow
        this.browsePage.classList.add('fade-in-page');
      }
    }
  }
}

export const navBar = new NavBar();
export default navBar;
