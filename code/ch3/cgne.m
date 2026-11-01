function [x, iter, residual] = cgne(A, b, x0, tol, maxIter)
    m = length(b);
    n = size(A, 2);
    ATA = A' * A;
    ATb = A' * b;
    
    r = b - A * x0; % 初始残差
    p = A' * r; % 初始搜索方向
    rsold = r' * r;
    x = x0;

    for i = 1:maxIter
        Ap = A * p;
        alpha = rsold / (Ap' * Ap);
        x = x + alpha * p;
        r = r - alpha * Ap;
        rsnew = r' * r;
        if sqrt(rsnew) < tol
            break;
        end
        p = A' * r + (rsnew / rsold) * p;
        rsold = rsnew;
    end
    iter = i;
    residual = sqrt(rsnew);
end