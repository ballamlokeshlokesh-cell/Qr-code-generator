FROM node:22-alpine
WORKDIR /app
COPY public ./public
COPY server.js ./server.js
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
