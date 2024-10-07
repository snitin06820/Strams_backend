import { Hono, Context, Next } from "hono";
import { z } from "zod";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cors } from "hono/cors";


type Variables = {
  db: NodePgDatabase;
};

export type Env = {
  JWT_SECRET: string;
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Allow CORS for all routes
app.use('*', cors({
  origin: 'https://edw4rd-streams.vercel.app/', // You can specify your frontend domain here
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.options('*', (c) => {
  c.res.headers.append('Access-Control-Allow-Origin', 'https://edw4rd-streams.vercel.app/');
  c.res.headers.append('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.res.headers.append('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return c.text('OK', 200);
});


app.use("*", async (c, next) => {
  const pool = new Pool({ connectionString: c.env.DATABASE_URL });
  const db = drizzle(pool);
  c.set("db", db);
  await next();
});

const movies = pgTable("Movie", {
  movieID: varchar("movieID").primaryKey(),
  title: varchar("title", { length: 255 }),
  posterLink: text("posterLink"),
  watchLink: text("watchLink"),
});

const users = pgTable("User", {
  id: varchar("id").primaryKey(),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 255 }),
  name: varchar("name", { length: 255 }),
});

const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const signupSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  password: z.string().min(8),
});

const movieSchema = z.object({
  title: z.string(),
  posterLink: z.string(),
  watchLink: z.string(),
});

const authenticate = async (c: Context) => {
  const header = c.req.header("authorization");
  if (!header) return null;

  const [bearer, token] = header.split(" ");
  if (bearer !== "Bearer" || !token) return null;

  try {
    return await jwt.verify(token, c.env.JWT_SECRET);
  } catch {
    return null;
  }
};

app.post("/signin", async (c) => {
  const body = await c.req.json();
  const { email, password } = userSchema.parse(body);

  const db = c.var.db;
  const user = await db.select().from(users).where(eq(users.email, email));

  if (!user || user.length === 0 || !(await bcrypt.compare(password, user[0]?.password))) {
    return c.json({ message: "Invalid credentials", status: 401 });
  }

  const token = jwt.sign({ id: user[0].id }, c.env.JWT_SECRET);
  return c.json({ token });
});

app.post("/signup", async (c) => {
  const body = await c.req.json();
  const { name, email, password } = signupSchema.parse(body);

  const db = c.var.db;
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  if (existingUser && existingUser.length) {
    return c.text("Email already in use", 400);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = await db
    .insert(users)
    .values({ id: uuidv4(), email, password: hashedPassword, name })
    .returning();

  const token = jwt.sign({ id: newUser[0].id }, c.env.JWT_SECRET);
  return c.json({ token });
});

const protectedRoute = async (c: Context, next: Next) => {
  const decoded = await authenticate(c);
  if (!decoded) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  c.set("userId", decoded.id);
  await next();
};

app.get("/user", protectedRoute, async (c) => {
  const db = c.var.db;
  const totalusers = await db.select().from(users);
  if (totalusers == null) {
    return c.text("No users in database", 404);
  } else {
    return c.json(totalusers);
  }
});

app.get("/movies", protectedRoute, async (c) => {
  const db = c.var.db;
  const allMovies = await db.select().from(movies);
  return c.json({ moviesData: allMovies });
});

app.post("/movies", protectedRoute, async (c) => {
  const db = c.var.db;
  const body = await c.req.json();
  const parsedBody = movieSchema.parse(body);

  const newMovie = await db
    .insert(movies)
    .values({
      movieID: uuidv4(),
      title: parsedBody.title,
      posterLink: parsedBody.posterLink,
      watchLink: parsedBody.watchLink,
    })
    .returning();

  return c.json(newMovie, 201);
});

app.put("/movies/:id", protectedRoute, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsedBody = movieSchema.parse(body);

  const updatedMovie = await db
    .update(movies)
    .set({
      title: parsedBody.title,
      posterLink: parsedBody.posterLink,
      watchLink: parsedBody.watchLink,
    })
    .where(eq(movies.movieID, id))
    .returning();

  return c.json(updatedMovie);
});

app.delete("/movies/:id", protectedRoute, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");

  await db.delete(movies).where(eq(movies.movieID, id));
  return c.text("Movie deleted successfully", 204);
});

export default app;
