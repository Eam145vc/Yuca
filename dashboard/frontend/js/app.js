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
        savingProperty: false,
        
        // Data
        propertyData: {
            name: '',
            type: '',
            address: '',
            description: '',
            maxGuests: 4,
            bedrooms: 2,
            beds: 3,
            bathrooms: 1.5,
            amenities: {},
            customFields: []
        },
        
        // Q&A Data
        qaList: [],
        newQA: {
            question: '',
            answer: '',
            category: ''
        },
        editingQA: null,
        qaSearchTerm: '',
        qaFilterCategory: '',
        
        // Analytics Data
        stats: {
            totalQA: 0,
            todayResponses: 24,
            escalations: 3,
            responseRate: 89
        },
        topQuestions: [],
        
        // Airbnb Integration
        airbnbStatus: {
            loggedIn: false,
            lastLogin: null,
            hoursAgo: 0,
            cookiesExpired: false
        },
        airbnbLoginInProgress: false,
        airbnbLoginOutput: [],
        
        // Bot Status
        botStatus: {
            active: true,
            lastCheck: new Date()
        },
        
        // UI Configuration
        menuItems: [
            { id: 'overview', name: 'Vista General', icon: 'layout-dashboard' },
            { id: 'property', name: 'Propiedad', icon: 'home' },
            { id: 'qa', name: 'Q&A', icon: 'message-circle' },
            { id: 'analytics', name: 'Análisis', icon: 'bar-chart-2' },
            { id: 'airbnb', name: 'Airbnb Login', icon: 'log-in' }
        ],
        
        amenitiesList: [
            {
                id: 'wifi',
                name: 'Wi-Fi',
                icon: 'wifi',
                fields: [
                    { id: 'ssid', label: 'Nombre de Red', type: 'text', placeholder: 'MiWiFi_5G' },
                    { id: 'password', label: 'Contraseña', type: 'text', placeholder: 'contraseña123' },
                    { id: 'speed', label: 'Velocidad', type: 'text', placeholder: '100 Mbps' }
                ]
            },
            {
                id: 'ac',
                name: 'Aire Acondicionado',
                icon: 'wind',
                fields: [
                    { id: 'areas', label: 'Áreas', type: 'text', placeholder: 'Habitaciones y sala' },
                    { id: 'type', label: 'Tipo', type: 'text', placeholder: 'Split, Inverter' },
                    { id: 'instructions', label: 'Instrucciones', type: 'text', placeholder: 'Control en mesa de noche' }
                ]
            },
            {
                id: 'kitchen',
                name: 'Cocina',
                icon: 'utensils',
                fields: [
                    { id: 'equipment', label: 'Equipamiento', type: 'text', placeholder: 'Nevera, estufa, microondas' },
                    { id: 'utensils', label: 'Utensilios', type: 'text', placeholder: 'Platos, cubiertos, ollas' }
                ]
            },
            {
                id: 'parking',
                name: 'Parqueadero',
                icon: 'car',
                fields: [
                    { id: 'type', label: 'Tipo', type: 'text', placeholder: 'Cubierto' },
                    { id: 'spaces', label: 'Espacios', type: 'number', placeholder: '1' },
                    { id: 'location', label: 'Ubicación', type: 'text', placeholder: 'Sótano 2, espacio #45' }
                ]
            },
            {
                id: 'tv',
                name: 'TV',
                icon: 'tv',
                fields: [
                    { id: 'channels', label: 'Canales', type: 'text', placeholder: 'Cable básico' },
                    { id: 'streaming', label: 'Streaming', type: 'text', placeholder: 'Netflix, Disney+' }
                ]
            },
            {
                id: 'washer',
                name: 'Lavadora',
                icon: 'circle',
                fields: [
                    { id: 'location', label: 'Ubicación', type: 'text', placeholder: 'Zona de lavandería' },
                    { id: 'instructions', label: 'Instrucciones', type: 'text', placeholder: 'Usar detergente líquido' }
                ]
            }
        ],
        
        // Initialization
        async init() {
            // Check authentication
            const token = localStorage.getItem('airbnbot_token');
            if (token) {
                this.isAuthenticated = true;
                await this.loadAllData();
                this.startPolling();
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
                this.loadPropertyData(),
                this.loadQAData(),
                this.loadAnalytics(),
                this.checkAirbnbStatus()
            ]);
        },
        
        async loadPropertyData() {
            try {
                const response = await this.apiCall('/dashboard/api/property');
                if (response.ok) {
                    const data = await response.json();
                    this.propertyData = { ...this.propertyData, ...data };
                    
                    // Initialize amenities if not present
                    this.amenitiesList.forEach(amenity => {
                        if (!this.propertyData.amenities[amenity.id]) {
                            this.propertyData.amenities[amenity.id] = { enabled: false };
                        }
                    });
                }
            } catch (error) {
                console.error('Error loading property data:', error);
            }
        },
        
        async loadQAData() {
            try {
                const response = await this.apiCall('/dashboard/api/qa');
                if (response.ok) {
                    const data = await response.json();
                    this.qaList = data;
                    this.stats.totalQA = data.length;
                }
            } catch (error) {
                console.error('Error loading Q&A data:', error);
            }
        },
        
        async loadAnalytics() {
            try {
                const response = await this.apiCall('/dashboard/api/analytics');
                if (response.ok) {
                    const data = await response.json();
                    this.stats = { ...this.stats, ...data.stats };
                    this.topQuestions = data.topQuestions || [];
                    
                    // Update charts
                    this.$nextTick(() => {
                        this.updateCharts(data);
                    });
                }
            } catch (error) {
                console.error('Error loading analytics:', error);
            }
        },
        
        // Property Management
        toggleAmenity(amenityId) {
            if (!this.propertyData.amenities[amenityId]) {
                this.propertyData.amenities[amenityId] = { enabled: false };
            }
            this.propertyData.amenities[amenityId].enabled = !this.propertyData.amenities[amenityId].enabled;
        },
        
        addCustomField() {
            this.propertyData.customFields.push({ label: '', value: '' });
        },
        
        removeCustomField(index) {
            this.propertyData.customFields.splice(index, 1);
        },
        
        async savePropertyData() {
            this.savingProperty = true;
            try {
                const response = await this.apiCall('/dashboard/api/property', {
                    method: 'POST',
                    body: JSON.stringify(this.propertyData)
                });
                
                if (response.ok) {
                    this.showToast('Información de propiedad guardada exitosamente');
                }
            } catch (error) {
                console.error('Error saving property data:', error);
                this.showToast('Error al guardar la información', 'error');
            } finally {
                this.savingProperty = false;
            }
        },
        
        resetPropertyForm() {
            this.loadPropertyData();
        },
        
        // Q&A Management
        async addNewQA() {
            try {
                const response = await this.apiCall('/dashboard/api/qa', {
                    method: 'POST',
                    body: JSON.stringify({
                        guest_question: this.newQA.question,
                        bot_answer: this.newQA.answer,
                        category: this.newQA.category
                    })
                });
                
                if (response.ok) {
                    await this.loadQAData();
                    this.newQA = { question: '', answer: '', category: '' };
                    this.showToast('Q&A agregada exitosamente');
                }
            } catch (error) {
                console.error('Error adding Q&A:', error);
                this.showToast('Error al agregar Q&A', 'error');
            }
        },
        
        editQA(qa) {
            this.editingQA = { ...qa };
        },
        
        async updateQA() {
            try {
                const response = await this.apiCall(`/dashboard/api/qa/${this.editingQA.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(this.editingQA)
                });
                
                if (response.ok) {
                    await this.loadQAData();
                    this.editingQA = null;
                    this.showToast('Q&A actualizada exitosamente');
                }
            } catch (error) {
                console.error('Error updating Q&A:', error);
                this.showToast('Error al actualizar Q&A', 'error');
            }
        },
        
        async deleteQA(id) {
            if (!confirm('¿Estás seguro de eliminar esta Q&A?')) return;
            
            try {
                const response = await this.apiCall(`/dashboard/api/qa/${id}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    await this.loadQAData();
                    this.showToast('Q&A eliminada exitosamente');
                }
            } catch (error) {
                console.error('Error deleting Q&A:', error);
                this.showToast('Error al eliminar Q&A', 'error');
            }
        },
        
        // Computed properties
        get filteredQAs() {
            return this.qaList.filter(qa => {
                const matchesSearch = !this.qaSearchTerm || 
                    qa.guest_question.toLowerCase().includes(this.qaSearchTerm.toLowerCase()) ||
                    qa.bot_answer.toLowerCase().includes(this.qaSearchTerm.toLowerCase());
                
                const matchesCategory = !this.qaFilterCategory || qa.category === this.qaFilterCategory;
                
                return matchesSearch && matchesCategory;
            });
        },
        
        // Airbnb Integration Methods
        async checkAirbnbStatus() {
            try {
                const response = await this.apiCall('/dashboard/api/airbnb/status');
                if (response.ok) {
                    const data = await response.json();
                    this.airbnbStatus = data;
                }
            } catch (error) {
                console.error('Error checking Airbnb status:', error);
            }
        },
        
        async startAirbnbLogin() {
            if (this.airbnbLoginInProgress) return;
            
            this.airbnbLoginInProgress = true;
            this.airbnbLoginOutput = [];
            
            try {
                const response = await this.apiCall('/dashboard/api/airbnb/login', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.showToast(data.message);
                    
                    // Poll for status updates
                    const pollInterval = setInterval(async () => {
                        await this.checkAirbnbStatus();
                        
                        // Check if login completed
                        if (this.airbnbStatus.loggedIn || !this.airbnbLoginInProgress) {
                            clearInterval(pollInterval);
                            this.airbnbLoginInProgress = false;
                            
                            if (this.airbnbStatus.loggedIn) {
                                this.showToast('Login completado exitosamente', 'success');
                            }
                        }
                    }, 5000); // Check every 5 seconds
                    
                    // Stop polling after 5 minutes
                    setTimeout(() => {
                        clearInterval(pollInterval);
                        this.airbnbLoginInProgress = false;
                    }, 5 * 60 * 1000);
                    
                } else {
                    const error = await response.json();
                    this.showToast(error.error || 'Error al iniciar login', 'error');
                    this.airbnbLoginInProgress = false;
                }
            } catch (error) {
                console.error('Error starting Airbnb login:', error);
                this.showToast('Error al conectar con el servidor', 'error');
                this.airbnbLoginInProgress = false;
            }
        },
        
        async clearAirbnbCookies() {
            if (!confirm('¿Estás seguro de que quieres limpiar las cookies de Airbnb?')) return;
            
            try {
                const response = await this.apiCall('/dashboard/api/airbnb/logout', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    await this.checkAirbnbStatus();
                    this.showToast('Cookies eliminadas exitosamente');
                }
            } catch (error) {
                console.error('Error clearing cookies:', error);
                this.showToast('Error al limpiar cookies', 'error');
            }
        },
        
        // UI Helpers
        getCurrentSectionTitle() {
            const section = this.menuItems.find(item => item.id === this.activeSection);
            return section ? section.name : 'Dashboard';
        },
        
        getCategoryName(category) {
            const categories = {
                'check-in': 'Check-in/out',
                'amenities': 'Comodidades',
                'rules': 'Reglas',
                'location': 'Ubicación',
                'other': 'Otros'
            };
            return categories[category] || 'Sin categoría';
        },
        
        formatDate(dateString) {
            if (!dateString) return 'N/A';
            const date = new Date(dateString);
            return date.toLocaleDateString('es-CO', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
            });
        },
        
        showToast(message, type = 'success') {
            this.successMessage = message;
            this.showSuccessToast = true;
            setTimeout(() => {
                this.showSuccessToast = false;
            }, 3000);
        },
        
        toggleDarkMode() {
            document.documentElement.classList.toggle('dark');
        },
        
        // API Helper
        async apiCall(url, options = {}) {
            const token = localStorage.getItem('airbnbot_token');
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            return fetch(url, {
                ...options,
                headers
            });
        },
        
        // Polling for real-time updates
        pollingInterval: null,
        
        startPolling() {
            this.pollingInterval = setInterval(async () => {
                await this.checkBotStatus();
                if (this.activeSection === 'analytics') {
                    await this.loadAnalytics();
                }
            }, 30000); // Check every 30 seconds
        },
        
        stopPolling() {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
        },
        
        async checkBotStatus() {
            try {
                const response = await fetch('/health');
                if (response.ok) {
                    const data = await response.json();
                    this.botStatus.active = data.services.bot === 'active';
                    this.botStatus.lastCheck = new Date();
                }
            } catch (error) {
                this.botStatus.active = false;
            }
        },
        
        // Charts
        updateCharts(analyticsData) {
            // Response Rate Chart
            const ctx = document.getElementById('responseRateChart');
            if (ctx && analyticsData.chartData) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: analyticsData.chartData.labels,
                        datasets: [{
                            label: 'Tasa de Respuesta Automática',
                            data: analyticsData.chartData.responseRates,
                            borderColor: 'rgb(147, 51, 234)',
                            backgroundColor: 'rgba(147, 51, 234, 0.1)',
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: {
                                display: false
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                max: 100,
                                ticks: {
                                    callback: function(value) {
                                        return value + '%';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    };
}