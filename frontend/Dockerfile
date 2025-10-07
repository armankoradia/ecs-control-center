FROM node:20-alpine

WORKDIR /app
COPY package.json tailwind.config.js postcss.config.js ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["npm", "start"]