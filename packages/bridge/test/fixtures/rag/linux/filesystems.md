# Linux filesystems

The virtual filesystem layer lets many concrete filesystems share one tree. Mounting attaches a filesystem at a directory called the mount point.

## Inodes

An inode stores file metadata such as owner, permissions, size and block pointers. The file name lives in a directory entry that points to the inode.

## Journaling

A journaling filesystem writes intended changes to a log before applying them. After a crash the log is replayed, which keeps metadata consistent without a full fsck.

## Hard and soft links

A hard link is another name for the same inode. A soft link stores a path and can cross filesystems.
