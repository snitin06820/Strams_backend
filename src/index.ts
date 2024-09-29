import { Hono } from "hono";
import { z } from "zod";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

type Variables = {
  db: NodePgDatabase;
};

type Bindings = {
  DATABASE_URL: string; // Database connection string
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", async (c, next) => {
  const pool = new Pool({
    connectionString: c.env.DATABASE_URL, // Use the DATABASE_URL environment variable
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

const movieSchema = z.object({
  title: z.string(),
  posterLink: z.string(),
  watchNowLink: z.string(),
});

// GET: Retrieve all movies
app.get("/movies", async (c) => {
  const db = c.var.db; // Retrieve the database client
  const allMovies = await db.select().from(movies);
  return c.json({ moviesData: allMovies });
});

// POST: Add a new movie
app.post("/movies", async (c) => {
  const db = c.var.db; // Retrieve the database client
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

  return c.json(newMovie, 201);
});

// PUT: Update a movie by ID
app.put("/movies/:id", async (c) => {
  const db = c.var.db; // Retrieve the database client
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

  return c.json(updatedMovie);
});

// DELETE: Remove a movie by ID
app.delete("/movies/:id", async (c) => {
  const db = c.var.db; // Retrieve the database client
  const id = c.req.param("id");

  await db.delete(movies).where(eq(movies.movieID, String(id)));

  return c.text("Movie deleted successfully", 204);
});

export default app;
