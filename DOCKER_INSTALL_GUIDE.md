# 🐘 Docker Installation Guide for Windows
# Required for Option A: Database Setup

## 📋 Prerequisites Check

### Current System:
- **OS**: Windows 10/11
- **Architecture**: x64
- **Docker**: NOT INSTALLED ❌

## 🚀 Installation Steps

### Option 1: Docker Desktop (Recommended)
1. **Download Docker Desktop**
   - Visit: https://www.docker.com/products/docker-desktop
   - Download: Docker Desktop Installer (Windows .exe)

2. **Install Docker Desktop**
   ```bash
   # Double-click the downloaded .exe file
   # Follow the installation wizard:
   # - Select default settings
   # - Enable WSL 2 integration (if available)
   # - Click "Install"
   ```

3. **Start Docker Desktop**
   - Launch Docker Desktop from Start Menu
   - Wait for services to start
   - Check status in system tray

4. **Verify Installation**
   ```bash
   docker --version
   docker compose version
   ```

### Option 2: WSL 2 + Docker CLI (Advanced)
1. **Install WSL 2**
   ```powershell
   # Open PowerShell as Administrator
   wsl --install
   ```

2. **Install Docker CLI**
   ```bash
   # In WSL terminal
   sudo apt update
   sudo apt install docker.io docker-compose
   sudo usermod -aG docker $USER
   ```

3. **Start Docker Service**
   ```bash
   sudo systemctl start docker
   ```

## 🔧 After Docker Installation

### Step 1: Create Docker Compose File
```bash
cd /c/Users/suraj/dating-bot
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: dating_bot
      POSTGRES_USER: dating_user
      POSTGRES_PASSWORD: dating_password_123
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./src/migrations:/docker-entrypoint-initdb.d
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
EOF
```

### Step 2: Start Services
```bash
cd /c/Users/suraj/dating-bot
docker-compose up -d
```

### Step 3: Verify Services
```bash
# Check service status
docker-compose ps

# Check PostgreSQL connection
docker exec postgres pg_isready -U dating_user -d dating_bot

# Check Redis connection
docker exec redis redis-cli ping

# Test application
npm start
```

## 🔍 Troubleshooting

### If Docker installation fails:
1. **Restart your computer** and try again
2. **Check Windows Firewall** - allow Docker exceptions
3. **Disable antivirus** temporarily
4. **Restart Docker Desktop** service

### If services fail to start:
```bash
# Check Docker logs
docker logs postgres
docker logs redis

# Restart services
docker-compose down
docker-compose up -d
```

### If application can't connect:
1. **Verify database URL in .env**:
   ```env
   DATABASE_URL=postgresql://dating_user:***@localhost:5432/dating_bot
   REDIS_URL=redisredis://localhost:6379
   ```

2. **Check if services are running**:
   ```bash
   netstat -an | grep 5432  # PostgreSQL
   netstat -an | grep 6379  # Redis
   ```

## ✅ Expected Outcome

After successful setup, you should see:

```
✅ PostgreSQL running on port 5432
✅ Redis running on port 6379
✅ Application can connect to database
✅ Ready to launch Telegram Dating Bot
```

## 🚀 Alternative: Local Installation

If Docker is not an option:

### Install PostgreSQL
- **Windows**: https://www.enterprisedb.com/downloads/postgres-postgresql
- **macOS**: `brew install postgresql`
- **Linux**: `sudo apt install postgresql`

### Install Redis
- **Windows**: https://github.com/tishion/redis-windows
- **macOS**: `brew install redis`
- **Linux**: `sudo apt install redis-server`

### After installation:
1. **Start services**
   ```bash
   # PostgreSQL
s   sudo systemctl start postgresql
   # Redis
   sudo systemctl start redis
   ```

2. **Update .env file** with local credentials
3. **Test connections**
4. **Start application**

## 📞 Need Help?

If you encounter any issues:
1. **Docker Community**: https://community.docker.com/
2. **Docker Hub**: https://hub.docker.com/
3. **Stack Overflow**: Search "docker-compose postgresql redis"
4. **Ask me for help** - I can guide you through specific issues

---

**🎯 Ready to proceed? Which Docker installation option would you like to try?**

**Option 1: Docker Desktop (Recommended)**
**Option 2: WSL 2 + Docker CLI**
**Option 3: Local Install**

**Tell me which option, and I'll guide you through the complete setup process!** 🚀