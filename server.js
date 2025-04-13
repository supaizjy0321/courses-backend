const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// PostgreSQL connection - Updated to use Azure PostgreSQL
const pool = new Pool({
    user: 'pgadmin',
    host: 'courses-server-zjy.postgres.database.azure.com',
    database: 'course_db',
    password: 'Test1234!',
    port: 5432,
    ssl: {
        rejectUnauthorized: false
    }
});

// Set search path to public schema on each connection
pool.on('connect', (client) => {
    client.query('SET search_path TO public');
});

// === Routes ===

// Get all courses with their assignments
app.get('/courses', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.name, c.course_link, c.study_hours, 
                   COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') AS assignments
            FROM courses c
            LEFT JOIN assignments a ON c.id = a.course_id
            GROUP BY c.id;
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Add a new course
app.post('/courses', async (req, res) => {
    const { name, course_link, study_hours } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO courses (name, course_link, study_hours) VALUES ($1, $2, $3) RETURNING *',
            [name, course_link, study_hours]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error adding course:', err);
        res.status(500).send('Server error');
    }
});

// Update a course
app.put('/courses/:id', async (req, res) => {
    const { id } = req.params;
    const { name, course_link, study_hours } = req.body;

    if (study_hours < 0) {
        return res.status(400).json({ error: 'Study hours cannot be negative' });
    }

    try {
        const result = await pool.query(
            'UPDATE courses SET name = $1, course_link = $2, study_hours = $3 WHERE id = $4 RETURNING *',
            [name, course_link, study_hours, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating course:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Delete a course
app.delete('/courses/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // First delete all assignments associated with this course
        await pool.query('DELETE FROM assignments WHERE course_id = $1', [id]);
        
        // Then delete the course
        const result = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING *', [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting course:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// === ASSIGNMENTS ===

// Add assignment to a course
app.post('/courses/:id/assignments', async (req, res) => {
    const { id } = req.params;
    const { name, due_date } = req.body;

    if (!name || !due_date) {
        return res.status(400).json({ error: 'Name and due date are required' });
    }

    try {
        const courseCheck = await pool.query('SELECT * FROM courses WHERE id = $1', [id]);
        if (courseCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const result = await pool.query(
            'INSERT INTO assignments (course_id, name, due_date) VALUES ($1, $2, $3) RETURNING *',
            [id, name, due_date]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating assignment:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get assignments for a specific course
app.get('/courses/:id/assignments', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM assignments WHERE course_id = $1 ORDER BY due_date ASC',
            [id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching assignments:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Fetch all assignments
app.get('/assignments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM assignments');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching assignments:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Create a new assignment
app.post('/assignments', async (req, res) => {
    const { name, due_date, is_completed, course_id } = req.body;

    if (!name || !due_date || !course_id) {
        return res.status(400).json({ error: 'Name, due date, and course ID are required' });
    }

    try {
        // Check if the course exists
        const courseCheck = await pool.query('SELECT * FROM courses WHERE id = $1', [course_id]);
        if (courseCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const result = await pool.query(
            'INSERT INTO assignments (course_id, name, due_date, is_completed) VALUES ($1, $2, $3, $4) RETURNING *',
            [course_id, name, due_date, is_completed || false]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating assignment:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/assignments/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM assignments WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).send('Assignment not found');
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching assignment:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Update assignment completion
app.put('/assignments/:id', async (req, res) => {
    const { id } = req.params;
    const { is_completed } = req.body;

    try {
        const result = await pool.query(
            'UPDATE assignments SET is_completed = $1 WHERE id = $2 RETURNING *',
            [is_completed, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send('Assignment not found');
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating assignment:', error);
        res.status(500).send('Internal Server Error');
    }
});

// DELETE an assignment by ID
app.delete('/assignments/:id', async (req, res) => {
    const assignmentId = req.params.id;

    try {
        const result = await pool.query('DELETE FROM assignments WHERE id = $1 RETURNING *', [assignmentId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a simple root route for health checks
app.get('/', (req, res) => {
    res.send('Courses API is running');
});

// === Start Server ===
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});