FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json requirements.txt ./
RUN npm ci --omit=dev && python3 -m venv /opt/pdf && /opt/pdf/bin/pip install --no-cache-dir -r requirements.txt
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PYTHON_BIN=/opt/pdf/bin/python
USER node
EXPOSE 3000
CMD ["node","server.js"]
