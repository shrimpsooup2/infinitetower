# The forge backend: serves the API (and a full copy of the game) from one
# Node process. No npm install needed; Node runs the TypeScript directly.
FROM node:22-slim
WORKDIR /app
COPY package.json index.html ./
COPY src ./src
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/infinitetower.db
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/main.ts"]
