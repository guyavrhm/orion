class NavigationService {
  constructor() {
    this.showDetailsPage = null;
    this.videoOverlay = null;
    this.bottomSheet = null;
    this.showDetailsTimeout = null;
    this.videoOverlayTimeout = null;
  }

  init() {
    this.showDetailsPage = document.getElementById('show-details-page');
    this.videoOverlay = document.getElementById('video-overlay');
    this.bottomSheet = document.getElementById('mobile-detail-sheet');
  }

  openShowDetails() {
    if (this.showDetailsTimeout) {
      clearTimeout(this.showDetailsTimeout);
      this.showDetailsTimeout = null;
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (this.showDetailsPage) {
      this.showDetailsPage.style.display = 'block';
      this.showDetailsTimeout = setTimeout(() => {
        this.showDetailsPage.classList.add('active');
        this.showDetailsTimeout = null;
      }, 10);
    }
  }

  closeShowDetails() {
    if (this.showDetailsTimeout) {
      clearTimeout(this.showDetailsTimeout);
      this.showDetailsTimeout = null;
    }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    if (this.showDetailsPage) {
      this.showDetailsPage.classList.remove('active');
      this.showDetailsTimeout = setTimeout(() => {
        this.showDetailsPage.style.display = 'none';
        this.showDetailsTimeout = null;
      }, 300);
    }
  }

  openPlayer() {
    if (this.videoOverlayTimeout) {
      clearTimeout(this.videoOverlayTimeout);
      this.videoOverlayTimeout = null;
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (this.videoOverlay) {
      this.videoOverlay.style.display = 'flex';
      this.videoOverlayTimeout = setTimeout(() => {
        this.videoOverlay.classList.add('active');
        this.videoOverlayTimeout = null;
      }, 10);
    }
  }

  closePlayer() {
    if (this.videoOverlayTimeout) {
      clearTimeout(this.videoOverlayTimeout);
      this.videoOverlayTimeout = null;
    }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    if (this.videoOverlay) {
      this.videoOverlay.classList.remove('active');
      this.videoOverlayTimeout = setTimeout(() => {
        this.videoOverlay.style.display = 'none';
        this.videoOverlayTimeout = null;
      }, 300);
    }
  }
}

export const navigationService = new NavigationService();
export default navigationService;
