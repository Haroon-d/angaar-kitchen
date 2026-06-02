# Angaar Kitchen

**Production Restaurant Management & Point of Sale (POS) System**

[Live Application](https://angaar-kitchen.vercel.app) • [Source Code](https://github.com/Haroon-d/angaar-kitchen)

---

## Overview

Angaar Kitchen is a production-ready Restaurant Management and Point of Sale (POS) platform developed to digitize restaurant operations, streamline order processing, and provide real-time business insights.

The system was initially developed for a real restaurant business and is actively used in a live production environment. It supports customer ordering, staff operations, billing, reporting, and restaurant administration through a modern web-based interface.

The platform is designed with scalability in mind and serves as the foundation for future multi-branch restaurant management capabilities.

---

## Production Status

**Status:** Live in Production

### Current Capabilities

* Customer-facing digital menu
* Order management and tracking
* Staff operations portal
* KOT, bill, and reciept Printing system
* Sales analytics dashboard
* Role-based access control
* Responsive web application for desktop and mobile devices

---

## Business Impact

Prior to implementation, restaurant operations were managed using manual processes and paper-based workflows.

The system provides:

* Centralized order management
* Digital billing and receipt generation
* Real-time sales visibility
* Operational reporting
* Reduced calculation errors
* Improved order processing efficiency
* Better visibility into daily business performance

The platform handles real restaurant operations and customer orders in a production environment.

---

## Key Features

### Restaurant Operations

* Staff management portal
* Order processing dashboard
* Receipt generation and printing
* Sales reporting and analytics
* Role-based permissions
* Administrative controls

### Technical Features

* Fully responsive design
* Type-safe development with TypeScript
* Form validation and error handling
* Modern component architecture
* Production deployment pipeline
* PostgreSQL relational database

---

## Technology Stack

| Category       | Technology           |
| -------------- | -------------------- |
| Frontend       | React 19             |
| Language       | TypeScript           |
| Routing        | TanStack Router      |
| UI Components  | Radix UI, shadcn/ui  |
| Styling        | Tailwind CSS         |
| Animations     | Framer Motion        |
| Database       | PostgreSQL           |
| Authentication | Supabase Auth        |
| Forms          | React Hook Form, Zod |
| Reporting      | Recharts             |
| PDF Generation | jsPDF                |
| Deployment     | Vercel               |

---

## System Architecture

```text
Customer Interface
        │
        ▼
React Frontend
        │
        ▼
Application Layer
        │
        ▼
PostgreSQL Database
        │
        ├── Orders
        ├── Menu Items
        ├── Users
        ├── Inventory
        └── Reports
```

---

## Project Structure

```text
angaar-kitchen/
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── lib/
│   └── integrations/
├── database/
├── migrations/
├── public/
└── assets/
```

---

## Local Development Setup

### Prerequisites

* Node.js
* npm
* PostgreSQL

### Installation

```bash
git clone https://github.com/Haroon-d/angaar-kitchen.git

cd angaar-kitchen

npm install

npm run dev
```

The application will be available at:

```text
http://localhost:5173
```

---

## Environment Configuration

Create a `.env` file and configure the required environment variables.

Example:

```env
DATABASE_URL=your_database_connection_string
```

Never commit sensitive credentials to version control.

---

## Database

The application uses PostgreSQL as its primary database.

Core entities include:

* Users
* Roles
* Menu Items
* Orders
* Order Items
* Reports

Database migrations are version-controlled to ensure consistency across environments.

---

## Roadmap

### Completed

* Digital menu system
* Online ordering
* Staff operations portal
* PDF receipt generation
* Sales analytics
* Role-based access control
* Production deployment

### Planned

* Multi-branch management
* Kitchen Display System (KDS)
* Inventory management
* WhatsApp notifications
* Automated reporting
* Performance analytics
* Customer loyalty program

---

## Development Approach

This project was developed using modern AI-assisted development workflows.

AI tools were used to accelerate development, debugging, architecture exploration, documentation, and testing while maintaining a focus on delivering a reliable production-ready system.

The primary objective was solving a real business problem and creating software that provides measurable operational value.

---

## Author

### Haroon Khan

Bioinformatics Student and Software Developer

Focused on building practical software solutions for real-world business challenges, including restaurant technology, marketplaces, and AI-powered systems.

**GitHub:** https://github.com/Haroon-d

**LinkedIn:** 

**Email:** mharoonkhan779@gmail.com

### Hanzlah Hassan
AI Engineer

Contributed to:
- Feature implementation
- Development support
- Testing and improvements

GitHub: https://github.com/Hanzlah-Hassan34

---

## License

This repository is provided for portfolio and educational purposes.

The Angaar Kitchen brand, business processes, and operational data remain the property of their respective owners.
