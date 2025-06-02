// AirbnBOT Dashboard Application
function dashboardApp() {
    return {
        // Authentication
        isAuthenticated: false,
        loginPin: '',
        loginError: false,
        
        // UI State
        sidebarOpen: true,
        activeSection: 'overview',
        showSuccessToast: false,
        successMessage: '',
        stats: {},
        topQuestions: [],
        chartData: { labels: [], responseRates: [] },
        // Airbnb Login State
        airbnbStatus: { loggedIn: false, lastLogin: null, hoursAgo: 0, cookiesExpired: false },
        airbnbLoginInProgress: false,
        airbnbLoginOutput: [],
        
        // Q&A Management
        qaCategory: 'frequent',  // 'frequent', 'less_common', 'custom'
        qaList: [],
        showAddQAModal: false,
        editingQA: null,
        qaForm: {
            question: '',
            answer: '',
            category: 'frequent'
        },
        showDeleteConfirmation: false,
        deleteQAId: null,
        
        // UI Configuration
        menuItems: [
            { id: 'overview', name: 'Vista General', icon: 'layout-dashboard' },
            { id: 'property', name: 'Propiedad', icon: 'home' },
            { id: 'qa', name: 'Q&A', icon: 'message-circle' },
            { id: 'analytics', name: 'Análisis', icon: 'bar-chart-2' },
            { id: 'airbnb', name: 'Airbnb Login', icon: 'log-in' }
        ],
        
        // Initialization
        async init() {
            // Check authentication
            const token = localStorage.getItem('airbnbot_token');
            if (token) {
                this.isAuthenticated = true;
                await this.loadAllData();
                this.startPolling();
                this.checkAirbnbStatus();
            }
            
            // Set up event listeners
            document.addEventListener('click', () => {
                lucide.createIcons();
            });
        },
        
        // Authentication Methods
        async login() {
            try {
                const response = await fetch('/dashboard/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin: this.loginPin })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    localStorage.setItem('airbnbot_token', data.token);
                    this.isAuthenticated = true;
                    this.loginError = false;
                    this.loginPin = '';
                    await this.loadAllData();
                    this.startPolling();
                } else {
                    this.loginError = true;
                }
            } catch (error) {
                console.error('Login error:', error);
                this.loginError = true;
            }
        },
        
        logout() {
            localStorage.removeItem('airbnbot_token');
            this.isAuthenticated = false;
            this.stopPolling();
        },
        
        // Data Loading
        async loadAllData() {
            await Promise.all([
                this.loadQAData(),
                this.loadAnalytics()
            ]);
        },
        
        // Q&A Management Methods
        async loadQAData() {
            try {
                const response = await this.apiCall('/dashboard/api/qa');
                if (response.ok) {
                    const data = await response.json();
                    this.qaList = data;
                }
            } catch (error) {
                console.error('Error loading Q&A data:', error);
                this.showToast('Error al cargar las preguntas y respuestas', 'error');
            }
        },
        // Analytics Management Methods
        async loadAnalytics() {
            try {
                const response = await this.apiCall('/dashboard/api/analytics');
                if (response.ok) {
                    const data = await response.json();
                    this.stats = data.stats;
                    this.topQuestions = data.topQuestions;
                    this.chartData = data.chartData;
                    this.initCharts();
                }
            } catch (error) {
                console.error('Error loading analytics:', error);
                this.showToast('Error al cargar analíticas', 'error');
            }
        },
        initCharts() {
            const ctx = document.getElementById('responseRateChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: this.chartData.labels,
                    datasets: [{
                        label: 'Tasa de Respuesta',
                        data: this.chartData.responseRates,
                        borderColor: '#7c3aed',
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
        },
        
        // Filter Q&As by category
        get filteredQAsByCategory() {
            return this.qaList.filter(qa => qa.category === this.qaCategory);
        },
        
        // Show Add Q&A Modal
        showAddQAForm() {
            this.qaForm = {
                question: '',
                answer: '',
                category: this.qaCategory
            };
            this.showAddQAModal = true;
        },
        
        // Edit Q&A
        editQA(qa) {
            this.qaForm = {
                id: qa.id,
                question: qa.question,
                answer: qa.answer,
                category: qa.category
            };
            this.editingQA = qa.id;
            this.showAddQAModal = true;
        },
        
        // Cancel Q&A Edit
        cancelQAEdit() {
            this.qaForm = {
                question: '',
                answer: '',
                category: this.qaCategory
            };
            this.editingQA = null;
            this.showAddQAModal = false;
        },
        
        // Save Q&A
        async saveQA() {
            try {
                let response;
                
                if (this.editingQA) {
                    // Update existing Q&A
                    response = await this.apiCall(`/dashboard/api/qa/${this.editingQA}`, {
                        method: 'PUT',
                        body: JSON.stringify(this.qaForm)
                    });
                } else {
                    // Create new Q&A
                    response = await this.apiCall('/dashboard/api/qa', {
                        method: 'POST',
                        body: JSON.stringify(this.qaForm)
                    });
                }
                
                if (response.ok) {
                    await this.loadQAData();
                    this.showAddQAModal = false;
                    this.editingQA = null;
                    this.qaForm = {
                        question: '',
                        answer: '',
                        category: this.qaCategory
                    };
                    this.showToast(this.editingQA ? 'Pregunta actualizada exitosamente' : 'Pregunta agregada exitosamente');
                }
            } catch (error) {
                console.error('Error saving Q&A:', error);
                this.showToast('Error al guardar la pregunta', 'error');
            }
        },
        
        // Confirm Delete Q&A
        confirmDeleteQA(id) {
            this.deleteQAId = id;
            this.showDeleteConfirmation = true;
        },
        
        // Delete Q&A
        async deleteQA() {
            if (!this.deleteQAId) return;
            
            try {
                const response = await this.apiCall(`/dashboard/api/qa/${this.deleteQAId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    await this.loadQAData();
                    this.showDeleteConfirmation = false;
                    this.deleteQAId = null;
                    this.showToast('Pregunta eliminada exitosamente');
                }
            } catch (error) {
                console.error('Error deleting Q&A:', error);
                this.showToast('Error al eliminar la pregunta', 'error');
            }
        },
        
        // UI Helpers
        getCurrentSectionTitle() {
            const section = this.menuItems.find(item => item.id === this.activeSection);
            return section ? section.name : 'Dashboard';
        },
        
        formatDate(dateString) {
            if (!dateString) return 'N/A';
            const date = new Date(dateString);
            return date.toLocaleDateString('es-CO', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        },
        
        showToast(message, type = 'success') {
            this.successMessage = message;
            this.showSuccessToast = true;
            setTimeout(() => {
                this.showSuccessToast = false;
            }, 3000);
        },
        
        // API Helper
        async apiCall(url, options = {}) {
            // Use relative URLs instead of hardcoded base URL
            const fetchUrl = url.startsWith('http') ? url : url;
            const token = localStorage.getItem('airbnbot_token');
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            return fetch(fetchUrl, {
                ...options,
                headers
            });
        },
        
        // Airbnb Login Methods
        async checkAirbnbStatus() {
            try {
                console.log('Checking Airbnb status...');
                const response = await this.apiCall('/dashboard/api/airbnb/status');
                console.log('Airbnb status response:', response.status);
                
                if (response.ok) {
                    const data = await response.json();
                    this.airbnbStatus = data;
                    console.log('Airbnb status data:', data);
                } else {
                    console.error('Airbnb status error:', await response.text());
                }
            } catch (error) {
                console.error('Error checking Airbnb status:', error);
            }
        },
        
        async startAirbnbLogin() {
            if (this.airbnbLoginInProgress) return;
            
            console.log('Starting Airbnb login process...');
            this.airbnbLoginInProgress = true;
            this.airbnbLoginOutput = ['Iniciando proceso de login...'];
            
            try {
                const response = await this.apiCall('/dashboard/api/airbnb/login', {
                    method: 'POST'
                });
                
                console.log('Airbnb login response:', response.status);
                
                const data = await response.json();
                console.log('Airbnb login data:', data);
                
                this.airbnbLoginOutput.push(data.message || 'Proceso iniciado');
                
                if (data.note) {
                    this.airbnbLoginOutput.push(data.note);
                }
                
                // Poll for status updates
                this.startLoginStatusPolling();
            } catch (error) {
                console.error('Error starting Airbnb login:', error);
                this.airbnbLoginOutput.push('Error al iniciar el proceso de login: ' + error.message);
                this.airbnbLoginInProgress = false;
            }
        },
        
        async clearAirbnbCookies() {
            try {
                console.log('Clearing Airbnb cookies...');
                const response = await this.apiCall('/dashboard/api/airbnb/logout', {
                    method: 'POST'
                });
                
                console.log('Clear cookies response:', response.status);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('Clear cookies data:', data);
                    this.showToast(data.message || 'Cookies eliminadas');
                    await this.checkAirbnbStatus();
                } else {
                    console.error('Clear cookies error:', await response.text());
                    this.showToast('Error al eliminar cookies', 'error');
                }
            } catch (error) {
                console.error('Error clearing Airbnb cookies:', error);
                this.showToast('Error al eliminar cookies: ' + error.message, 'error');
            }
        },
        
        startLoginStatusPolling() {
            // Poll for status updates every 5 seconds
            const pollInterval = setInterval(async () => {
                await this.checkAirbnbStatus();
                
                if (this.airbnbStatus.loggedIn) {
                    this.airbnbLoginOutput.push('✅ Login completado con éxito');
                    this.airbnbLoginInProgress = false;
                    clearInterval(pollInterval);
                    this.showToast('Login en Airbnb completado');
                }
            }, 5000);
            
            // Stop polling after 5 minutes (maximum time for login)
            setTimeout(() => {
                if (this.airbnbLoginInProgress) {
                    clearInterval(pollInterval);
                    this.airbnbLoginInProgress = false;
                    this.airbnbLoginOutput.push('⚠️ Tiempo de espera agotado. Verifica el estado manualmente.');
                }
            }, 5 * 60 * 1000);
        },
        
        // Polling for real-time updates
        pollingInterval: null,
        
        startPolling() {
            this.pollingInterval = setInterval(async () => {
                if (this.activeSection === 'qa') {
                    await this.loadQAData();
                }
            }, 30000); // Check every 30 seconds
        },
        
        stopPolling() {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
        }
    };
}