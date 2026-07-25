# firefly-iii-sankey-web


## Docker Compose
```
services:
  firefly-sankey-web:
    build: https://github.com/your-username/firefly-sankey-web.git#main
    container_name: firefly-sankey-web
    ports:
      - "8088:3000"
    environment:
      - FIREFLY_URL=https://firefly.yourdomain.com
      - FIREFLY_TOKEN=your_personal_access_token_here
      - PORT=3000
    restart: unless-stopped
```
