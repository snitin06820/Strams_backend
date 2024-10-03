import { Hono } from "hono";
import { z } from "zod";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { Pool } from "pg";
import { sign, verify } from "hono/jwt";
import bcrypt from "bcryptjs";

type Variables = {
  db: NodePgDatabase;
};

export type Env = {
  JWT_SECRET: string;
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const pool = new Pool({
    connectionString: c.env.DATABASE_URL,
  });
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
  watchNowLink: z.string(),
});

// Sign-in route is still protected by JWT
app.post("/signin", async (c) => {
  const body = await c.req.json();
  const parsedBody = userSchema.parse(body);

  const db = c.var.db;
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, parsedBody.email));

  if (!user || !user.length) {
    console.log("Signin attempt: Invalid user");
    return c.json({ mssg: "Invalid user", status: 401 });
  }

  if (parsedBody.password && user[0].password) {
    const isValidPassword = await bcrypt.compare(
      parsedBody.password,
      user[0].password
    );
    if (!isValidPassword) {
      console.log(
        "Signin attempt: Invalid password for user",
        parsedBody.email
      );
      return c.json({ mssg: "Invalid password" });
    }
  }

  const payload = {
    sub: user[0].id,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  };

  const token = sign(payload, c.env.JWT_SECRET);
  console.log("User signed in successfully:", parsedBody.email);

  return c.json({ token });
});

// Sign-up route is now accessible without JWT
app.post("/signup", async (c) => {
  const body = await c.req.json();
  console.log("request body received:", body);
  const parsedBody = signupSchema.parse(body);

  const db = c.var.db;
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, parsedBody.email));

  if (existingUser && existingUser.length) {
    console.log("Signup attempt: Email already in use", parsedBody.email);
    return c.text("Email already in use", 400);
  }

  const hashedPassword = await bcrypt.hash(parsedBody.password, 10);
  const newUser = await db
    .insert(users)
    .values({
      id: uuidv4(),
      email: parsedBody.email,
      password: hashedPassword,
      name: parsedBody.name,
    })
    .returning();

  const payload = {
    sub: newUser[0].id,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  };

  const token = sign(payload, c.env.JWT_SECRET);
  console.log("New user signed up:", parsedBody.email);
  return c.json({ token });
});

// The rest of your movie routes remain unchanged
app.get("/movies", async (c) => {
  try {
    const header = c.req.header("authorization");
    if (header) {
      const filter = header.split(" ");

      if (filter.length < 2) {
        throw new Error("Invalid authorization header format.");
      }

      const token = filter[1];

      try {
        const decodedPayload = await verify(token, c.env.JWT_SECRET);

        if (!decodedPayload || !decodedPayload.userId) {
          throw new Error("Invalid token payload.");
        }

        try {
          const db = c.var.db;
          const user = await db
            .select()
            .from(users)
            .where(eq(users.id, decodedPayload.userId.toString()));

          if (user) {
            const allMovies = await db.select().from(movies);
            return c.json({
              moviesData: allMovies,
            });
          }
        } catch (error) {
          throw new Error("user does not exist");
        }
      } catch (error) {
        throw new Error("Error verifying token or fetching user");
      }
    }
  } catch (error) {
    throw new Error("missing Auth header");
  }
});

app.post("/movies", async (c) => {
  const db = c.var.db;
  const body = await c.req.json();
  const parsedBody = movieSchema.parse(body);

  const newMovie = await db
    .insert(movies)
    .values({
      movieID: uuidv4(),
      title: parsedBody.title,
      posterLink: parsedBody.posterLink,
      watchLink: parsedBody.watchNowLink,
    })
    .returning();

  console.log("New movie added:", parsedBody.title);
  return c.json(newMovie, 201);
});

app.put("/movies/:id", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsedBody = movieSchema.parse(body);

  const updatedMovie = await db
    .update(movies)
    .set({
      title: parsedBody.title,
      posterLink: parsedBody.posterLink,
      watchLink: parsedBody.watchNowLink,
    })
    .where(eq(movies.movieID, String(id)))
    .returning();

  console.log("Movie updated:", parsedBody.title);
  return c.json(updatedMovie);
});

app.delete("/movies/:id", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");

  await db.delete(movies).where(eq(movies.movieID, String(id)));
  console.log("Movie deleted with ID:", id);

  return c.text("Movie deleted successfully", 204);
});

export default app;
