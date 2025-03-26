import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Налаштування CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

app.use(express.json());
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ------------------dishes--------------------------------------
app.get("/api/dishes", async (_, res) => {
  try {
    const dishesRef = db.collection("dishes");
    const snapshot = await dishesRef.get();

    if (snapshot.empty) {
      return res.status(404).json({
        message: "Страви не знайдено",
      });
    }

    const dishes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      price: Number(doc.data().price),
    }));

    res.status(200).json(dishes);
  } catch (error) {
    console.error("Помилка при отриманні страв: ", error);
    res.status(500).json({
      message: "Помилка при отриманні страв",
      error: error.message,
    });
  }
});

// ------------------basket--------------------------------------

app.get("/api/basket/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      message: "Відсутні дані про користувача",
    });
  }

  try {
    const basketRef = db.collection("baskets");
    const userBasketQuery = basketRef.doc(userId);
    const snapshot = await userBasketQuery.get();

    if (snapshot.exists) {
      const basketData = snapshot.data();
      res.status(200).json({
        basket: basketData.basket || [],
      });
    } else {
      res.status(200).json({
        basket: [],
      });
    }
  } catch (error) {
    console.error("Помилка при отрманін кошика: ", error);
    res.status(500).json({
      message: "Помилка при отриманні кошика",
      error: error.message,
    });
  }
});

app.post("/api/basket", async (req, res) => {
  const { userId, basket } = req.body;

  if (!userId || !basket) {
    return res.status(400).json({
      message: "Відсутні дані про користувача або корзину",
    });
  }

  try {
    const basketRef = db.collection("baskets");
    await basketRef.doc(userId).set({ basket });

    res.status(200).json({
      message: "Кошик успішно збережено",
    });
  } catch (error) {
    console.error("Помилка при збереженні кошика: ", error);
    res.status(500).json({
      message: "Помилка при збереженні кошика",
      error: error.message,
    });
  }
});

// ------------------orders--------------------------------------

app.get("/api/orders/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const ordersRef = db.collection("orders");
    const snapshot = await ordersRef.doc(userId).get();

    if (snapshot.empty) {
      return res.status(404).json({
        message: "Замовлення не знайдено",
      });
    }
    const orders = snapshot.data()?.orders || [];

    res.status(200).json(orders);
  } catch (error) {
    console.error("Помилка при отриманні замовлень: ", error);
    res.status(500).json({
      message: "Помилка при отриманні замовлень",
      error: error.message,
    });
  }
});

app.post("/api/orders", async (req, res) => {
  const { userId, order } = req.body;

  if (!userId || !order) {
    return res.status(400).json({
      message: "Відсутні дані про користувача або корзину",
    });
  }

  if (!order.items || order.items.length < 1 || order.items.length > 10) {
    return res.status(400).json({
      message: "Кількість страв повинна бути в межах від 1 до 10",
    });
  }

  try {
    const ordersRef = db.collection("orders");
    const snapshot = await ordersRef.doc(userId).get();

    let newOrderId = 1;
    let currentOrders = [];

    if (snapshot.exists) {
      currentOrders = snapshot.data().orders || [];
      newOrderId = currentOrders.length + 1;
    }

    await ordersRef.doc(userId).set({
      orders: [
        ...currentOrders,
        {
          orderId: newOrderId,
          ...order,
        },
      ],
    });

    res.status(200).json({ message: "Замовлення успішно збережено" });
  } catch (error) {
    console.error("Помилка при збереженні замовлення: ", error);
    res.status(500).json({
      message: "Помилка при збереженні замовлення",
      error: error.message,
    });
  }
});

app.patch("/api/orders/:userId/:orderId/:dishId", async (req, res) => {
  const { userId, orderId, dishId } = req.params;
  const { grade } = req.body;

  if (!userId || !orderId || !dishId || !grade) {
    return res.status(400).json({
      message: "Відсутні обов'язкові дані",
    });
  }

  try {
    const ordersRef = db.collection("orders");
    const snapshot = await ordersRef.doc(userId).get();

    if (!snapshot.exists) {
      return res.status(404).json({
        message: "Замовлення не знайдено",
      });
    }

    const orders = snapshot.data().orders || [];
    const orderIndex = orders.findIndex(
      (order) => order.orderId === Number(orderId)
    );

    if (orderIndex === -1) {
      return res.status(404).json({
        message: "Замовлення не знайдено",
      });
    }

    const dishIndex = orders[orderIndex].items.findIndex(
      (item) => item.orderDishId === Number(dishId)
    );

    if (dishIndex === -1) {
      return res.status(404).json({
        message: "Страва не знайдена в замовленні",
      });
    }

    orders[orderIndex].items[dishIndex].grade = grade;

    await ordersRef.doc(userId).set({ orders });

    res.status(200).json({
      message: "Оцінка успішно встановлена",
    });
  } catch (error) {
    console.error("Помилка при оновленні оцінки: ", error);
    res.status(500).json({
      message: "Помилка при оновленні оцінки",
      error: error.message,
    });
  }
});

// ------------------authentication--------------------------------------

// Middleware для перевірки авторизації
const authenticateUser = async (req, res, next) => {
  try {
    const idToken = req.headers.authorization?.split("Bearer ")[1];
    if (!idToken) {
      return res.status(401).json({ message: "Неавторизований доступ" });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Помилка перевірки токена:", error);
    res.status(401).json({ message: "Неавторизований доступ" });
  }
};

app.post("/api/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Відсутні обов'язкові поля" });
    }

    // Створюємо користувача
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    // Створюємо customToken
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    // Отримуємо idToken через Firebase Auth REST API
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${serviceAccount.webApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    const data = await response.json();
    res.status(201).json({
      message: "Користувача успішно створено",
      token: data.idToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
      },
    });
  } catch (error) {
    console.error("Помилка реєстрації:", error);
    if (error.code === "auth/email-already-in-use") {
      res
        .status(400)
        .json({
          message: "Обліковий запис з такою електронною поштою вже існує",
        });
    } else {
      res.status(500).json({ message: "Помилка при створенні користувача" });
    }
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Відсутні обов'язкові поля" });
    }

    // Отримуємо користувача за email
    const userRecord = await admin.auth().getUserByEmail(email);

    // Створюємо customToken
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    // Отримуємо idToken через Firebase Auth REST API
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${serviceAccount.webApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    const data = await response.json();
    res.status(200).json({
      message: "Успішний вхід",
      token: data.idToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
      },
    });
  } catch (error) {
    console.error("Помилка входу:", error);
    res.status(401).json({ message: "Неправильний email або пароль" });
  }
});

app.post("/api/logout", authenticateUser, async (req, res) => {
  try {
    await admin.auth().revokeRefreshTokens(req.user.uid);
    res.json({ message: "Успішний вихід" });
  } catch (error) {
    console.error("Помилка виходу:", error);
    res.status(500).json({ message: "Помилка при виході" });
  }
});

app.get("/api/user", authenticateUser, async (req, res) => {
  try {
    const userRecord = await admin.auth().getUser(req.user.uid);
    res.json({
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
      },
    });
  } catch (error) {
    console.error("Помилка отримання користувача:", error);
    res
      .status(500)
      .json({ message: "Помилка при отриманні даних користувача" });
  }
});

// Додаємо обробку всіх маршрутів для React Router
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Сервер запущено на http://localhost:${port}`);
});
