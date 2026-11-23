FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7000

COPY package.json icon.png ./
COPY src/ ./src/

USER node
EXPOSE 7000
CMD ["node", "src/server.js"]
