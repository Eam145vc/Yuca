# AirbnBOT

AirbnBOT is an automated guest communication system for Airbnb hosts with an admin dashboard.

## Features

- 🤖 Automated guest message monitoring and responses
- 📊 Admin dashboard for managing properties and communications
- 🔔 Telegram notifications for important messages
- 📈 Analytics and insights
- 🔒 Secure credential management

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/airbnbot.git
   cd airbnbot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your credentials and API keys

4. Set up data files:
   - Copy `data/data.example.json` to the following files in the `data/` directory:
     - `business_data.json`
     - `cookies.json`
     - `dashboard_qa_log.json`
     - `qa_log.json`
     - `thread_states.json`
   - Update each file with your actual data

5. Start the application:
   ```bash
   # Development mode (with hot reload)
   npm run all:dev
   
   # Production mode
   npm run all
   ```

## Documentation

- [Project Architecture](./ARCHITECTURE_IMPROVEMENT_PLAN.md)
- [Project Documentation](./PROJECT_DOCUMENTATION.md)

## Available Scripts

- `npm run start` - Start the server
- `npm run dev` - Start the server in development mode
- `npm run bot` - Start the message monitoring bot
- `npm run bot:dev` - Start the bot in development mode
- `npm run dashboard` - Start the dashboard server
- `npm run all` - Start both bot and dashboard
- `npm run all:dev` - Start both in development mode
- `npm run setup` - Run initial setup script

## Security Notes

- Never commit the `.env` file
- Never commit files in the `data/` directory
- Use environment variables for all sensitive information
- Regularly rotate API keys and access tokens

## Contributing

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Commit your changes (`git commit -m 'feat: add amazing feature'`)
3. Push to the branch (`git push origin feature/amazing-feature`)
4. Open a Pull Request

## License

This project is licensed under the ISC License.
