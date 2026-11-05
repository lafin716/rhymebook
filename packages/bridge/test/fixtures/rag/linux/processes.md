# Linux processes

Every running program is a process with a unique PID. The kernel keeps the parent PID so that orphaned children are re-parented to init.

## Signals

SIGTERM asks a process to exit and can be caught. SIGKILL cannot be caught or ignored, so the kernel stops the process immediately.

## Scheduling

The Completely Fair Scheduler gives each runnable task a share of CPU time proportional to its nice value. Lower nice values get more CPU.

## Zombie processes

A zombie is a finished child whose exit status has not been collected by its parent with wait(). It holds a PID but no memory.
