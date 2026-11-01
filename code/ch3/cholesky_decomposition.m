function L = cholesky_decomposition(A)
    n = size(A, 1);
    L = zeros(n);

    for i = 1:n
        for j = 1:i
            sum = 0;
            if (j == i)
                for k = 1:j-1
                    sum = sum + L(j, k)^2;
                end
                L(j, j) = sqrt(A(j, j) - sum);
            else
                for k = 1:j-1
                    sum = sum + L(i, k) * L(j, k);
                end
                L(i, j) = (A(i, j) - sum) / L(j, j);
            end
        end
    end
end